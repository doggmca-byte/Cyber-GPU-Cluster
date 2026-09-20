-- harvest_user_hash: ліміт накопичення без збору 12 год -> 8 год
-- (v_max_unclaimed_seconds 43200 -> 28800). Лише це значення: решта тіла функції
-- ідентична версії з 20260920120000_collect_hash_atomic_snapshot.sql.
-- Тримати синхронізовано з MAX_UNCLAIMED_HOURS у lib/constants/economy.ts.
create or replace function public.harvest_user_hash(p_user_id uuid)
returns numeric(18, 6)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now                    timestamptz;
    v_total_harvested        numeric(18, 6) := 0;
    v_elapsed_seconds         numeric;
    v_row_harvested            numeric(18, 6);
    v_row_cap                  numeric(18, 6);
    v_row_headroom              numeric(18, 6);
    v_gpu                      record;
    v_referrer_id              uuid;
    v_lifetime_hash            numeric(18, 6);
    v_threshold_hash           constant numeric(18, 6) := 100;
    v_max_unclaimed_seconds  constant numeric           := 28800;   -- 8 годин
    -- lib/constants/economy.ts GPU_LIFECYCLE_MULTIPLIER / HASH_TO_TON_RATE —
    -- тримати синхронізовано вручну.
    v_lifecycle_multiplier   constant numeric           := 1.25;
    v_hash_to_ton_rate        constant numeric           := 0.00001;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    v_now := clock_timestamp();

    for v_gpu in
        select ug.id, ug.amount, ug.last_harvest_at, ug.lifetime_hash_generated, ug.is_dead,
               gt.hash_per_second, gt.cost_ton
        from public.user_gpus ug
        join public.gpu_templates gt on gt.level = ug.gpu_level
        where ug.user_id = p_user_id
          and ug.amount > 0
        order by ug.id
        for update of ug
    loop
        if v_gpu.is_dead then
            continue;
        end if;

        v_elapsed_seconds := least(
            greatest(extract(epoch from (v_now - v_gpu.last_harvest_at)), 0),
            v_max_unclaimed_seconds
        );
        v_row_harvested := round(v_elapsed_seconds * v_gpu.hash_per_second * v_gpu.amount, 6);

        v_row_cap := (v_gpu.cost_ton * v_lifecycle_multiplier * v_gpu.amount) / v_hash_to_ton_rate;
        v_row_headroom := greatest(v_row_cap - v_gpu.lifetime_hash_generated, 0);

        if v_row_harvested >= v_row_headroom then
            v_row_harvested := v_row_headroom;
            update public.user_gpus
                set last_harvest_at = greatest(last_harvest_at, v_now),
                    lifetime_hash_generated = lifetime_hash_generated + v_row_harvested,
                    is_dead = true
                where id = v_gpu.id;
        else
            update public.user_gpus
                set last_harvest_at = greatest(last_harvest_at, v_now),
                    lifetime_hash_generated = lifetime_hash_generated + v_row_harvested
                where id = v_gpu.id;
        end if;

        v_total_harvested := v_total_harvested + v_row_harvested;
    end loop;

    if v_total_harvested > 0 then
        update public.profiles as pr
            set hash_balance = pr.hash_balance + v_total_harvested,
                lifetime_hash_generated = pr.lifetime_hash_generated + v_total_harvested,
                harvest_count = pr.harvest_count + 1
            where pr.id = p_user_id
            returning pr.lifetime_hash_generated into v_lifetime_hash;

        if v_referrer_id is not null and v_lifetime_hash >= v_threshold_hash then
            update public.referrals
                set has_reached_threshold = true
                where referrer_id = v_referrer_id
                  and referee_id = p_user_id
                  and has_reached_threshold = false;
        end if;
    end if;

    return v_total_harvested;
end;
$$;
