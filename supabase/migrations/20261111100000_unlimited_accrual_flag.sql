-- =====================================================================================
-- Персональний виняток із ліміту накопичення без збору (8 год): profiles.unlimited_accrual.
--
-- Для людини з прапорцем harvest_user_hash не обрізає elapsed до 8 год — вона може
-- заходити за кліймом раз на добу/тиждень і нічого не втрачає. Все інше без змін:
-- ліміт життєвого циклу картки (cost * 1.25 / rate) працює як працював, тож картка
-- вмирає на своєму капі так само, як у всіх. Для решти (прапорець false, за
-- замовчуванням) поведінка байт-у-байт та сама, що й була: 28800 с.
--
-- Тіла harvest_user_hash / list_paused_production_users взято з прод-БД
-- (pg_get_functiondef) і змінено лише в позначених місцях.
-- list_paused_production_users тепер пропускає таких людей: виробництво в них не
-- зупиняється, тож сповіщення "склад повний" їм не потрібне.
-- =====================================================================================
alter table public.profiles
    add column if not exists unlimited_accrual boolean not null default false;

CREATE OR REPLACE FUNCTION public.harvest_user_hash(p_user_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
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
    v_max_unclaimed_seconds  numeric;
    v_unlimited_accrual      boolean;
    v_lifecycle_multiplier   constant numeric           := 1.25;
    v_hash_to_ton_rate        constant numeric           := 0.00001;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    select pr.referrer_id, pr.unlimited_accrual into v_referrer_id, v_unlimited_accrual
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- Персональний виняток: без ліміту 8 год накопичення (людині не треба заходити
    -- по клейм кожні 8 год). Ліміт життєвого циклу картки (headroom нижче) діє
    -- як і раніше. 100 років = практично "без обмеження за часом".
    v_max_unclaimed_seconds := case when v_unlimited_accrual then 3153600000 else 28800 end;

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

CREATE OR REPLACE FUNCTION public.list_paused_production_users(p_max_unclaimed_hours integer DEFAULT 12)
 RETURNS TABLE(profile_id uuid, telegram_id bigint, telegram_language_code text, hash_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
    with paused as (
        select ug.user_id, max(ug.last_harvest_at) as last_activity
            from public.user_gpus ug
            where ug.amount > 0
              and ug.is_dead = false
            group by ug.user_id
            having max(ug.last_harvest_at) <= now() - (p_max_unclaimed_hours || ' hours')::interval
    )
    select pr.id, pr.telegram_id, pr.telegram_language_code, pr.hash_balance
        from public.profiles pr
        join paused p on p.user_id = pr.id
        where not pr.is_bot_blocked
          and not pr.unlimited_accrual
          and (pr.production_paused_notified_at is null
               or pr.production_paused_notified_at < p.last_activity);
$$;

-- Перший (і поки єдиний) отримувач: telegram_id 2072267275.
update public.profiles set unlimited_accrual = true where telegram_id = 2072267275;
