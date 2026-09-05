-- =====================================================================================
-- Три незалежні виправлення за одним запитом користувача:
--
--   1) Реальний баг, знайдений через живий репорт "failed to load deposits:
--      Bad Request" в адмінці ("Статистика амбасадорів"): /api/admin/ambassadors/stats
--      робив .in("user_id", refereeIds) з JS — а в одного амбасадора вже 474
--      рефералів, у іншого 256 (SELECT підтвердив живими даними). Список із
--      сотень UUID у query-рядку URL перевищує ліміт довжини URL на
--      Vercel/PostgREST-проксі → 400 Bad Request ще ДО того, як PostgREST
--      встигає розібрати сам запит (тому повідомлення таке лаконічне —
--      "Bad Request", а не деталізована Postgres-помилка). Це працювало,
--      доки в жодного амбасадора не назбиралось стільки рефералів — тепер
--      назбиралось. Фікс — вважати статистику ЦІЛКОМ на боці Postgres
--      (admin_ambassador_stats()), без передачі жодного списку ID через HTTP
--      узагалі: масштабується на будь-яку кількість рефералів.
--
--      Ця сама функція одразу рахує active_referred_count (has_reached_threshold
--      = true) і milestone_met (>= 30) — потрібно для "не блокувати заявку на
--      вивід, а просто показати адміну, що амбасадора треба перевірити
--      вручну" (див. app/api/wallet/withdraw — виклик check_ambassador_withdrawal_gate
--      звідти прибрано, сама ця RPC-функція більше не потрібна й видаляється).
--
--   2) Прибираємо разовий реферальний бонус 0.01 TON за перший цикл збору
--      реферала (harvest_user_hash) — лишаємо тільки 5% з депозитів
--      (process_successful_deposit) і 0.01 TON/1000 HASH обміну
--      (exchange_hash_to_ton), за проханням користувача. has_reached_threshold
--      САМ ПРАПОРЕЦЬ лишаємо виставлятись і далі (без грошового нарахування) —
--      його вже використовує ambassador-онбординговий облік
--      (admin_ambassador_stats.active_referred_count/milestone_met) і
--      /api/friends/stats (active_friends_count) — це той самий "реферал
--      реально почав фармити" індикатор, просто без прив'язаної виплати.
--
--   3) Ambassador withdrawal gate більше НЕ блокує заявку і НЕ знімає
--      is_ambassador автоматично (зміна продуктового рішення користувача:
--      "не отклоняй заявки если не набрано или накрут — просто в админ
--      панеле отображай в статистике амбассадора что надо проверить
--      вручну"). check_ambassador_withdrawal_gate видаляється —
--      request_withdrawal і так уже лишає лише 2 TON/заявка кап для
--      is_ambassador (20260905120000_ambassador_withdrawal_restrictions.sql,
--      НЕ чіпаємо), рішення "схвалити/відхилити/зняти амбасадора" тепер
--      цілком ручне, на основі admin_ambassador_stats.
-- =====================================================================================

drop function if exists public.check_ambassador_withdrawal_gate(uuid);

create or replace function public.admin_ambassador_stats()
returns table (
    telegram_id                  bigint,
    username                     text,
    first_name                   text,
    referred_count               integer,
    referred_with_deposit_count  integer,
    total_real_deposit_ton       numeric,
    active_referred_count        integer,
    inactive_referred_count      integer,
    suspected_farming            boolean,
    milestone_met                boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
    select
        p.telegram_id,
        p.username,
        p.first_name,
        count(r.referee_id)::integer as referred_count,
        count(*) filter (where dep.total_deposit > 0)::integer as referred_with_deposit_count,
        coalesce(sum(dep.total_deposit), 0)::numeric as total_real_deposit_ton,
        count(*) filter (where r.has_reached_threshold)::integer as active_referred_count,
        count(*) filter (
            where r.referee_id is not null
              and not coalesce(gpu.has_gpu, false)
              and not coalesce(task.has_task, false)
        )::integer as inactive_referred_count,
        (
            count(r.referee_id) >= 10
            and count(*) filter (
                where r.referee_id is not null
                  and not coalesce(gpu.has_gpu, false)
                  and not coalesce(task.has_task, false)
            )::numeric / nullif(count(r.referee_id), 0) >= 0.5
        ) as suspected_farming,
        (count(*) filter (where r.has_reached_threshold) >= 30) as milestone_met
    from public.profiles p
    left join public.referrals r on r.referrer_id = p.id
    left join lateral (
        select sum(t.amount) as total_deposit
        from public.transactions t
        where t.user_id = r.referee_id
          and t.type = 'deposit'
          and t.status = 'completed'
    ) dep on r.referee_id is not null
    left join lateral (
        select true as has_gpu
        from public.user_gpus ug
        where ug.user_id = r.referee_id and ug.amount > 0
        limit 1
    ) gpu on r.referee_id is not null
    left join lateral (
        select true as has_task
        from public.user_tasks ut
        where ut.user_id = r.referee_id and ut.status in ('completed', 'claimed')
        limit 1
    ) task on r.referee_id is not null
    where p.is_ambassador = true
    group by p.id, p.telegram_id, p.username, p.first_name
    order by p.telegram_id;
$$;

revoke all on function public.admin_ambassador_stats() from public, anon, authenticated;
grant execute on function public.admin_ambassador_stats() to service_role;

-- ------------------------------------------------------------------------------------
-- harvest_user_hash: прибираємо виплату 0.01 TON / transactions-запис за
-- перший цикл збору реферала, лишаємо лише has_reached_threshold-прапорець.
-- ------------------------------------------------------------------------------------
create or replace function public.harvest_user_hash(p_user_id uuid)
returns numeric(18, 6)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now                    timestamptz := clock_timestamp();
    v_total_harvested        numeric(18, 6) := 0;
    v_elapsed_seconds         numeric;
    v_row_harvested            numeric(18, 6);
    v_row_cap                  numeric(18, 6);
    v_row_headroom              numeric(18, 6);
    v_gpu                      record;
    v_referrer_id              uuid;
    v_lifetime_hash            numeric(18, 6);
    v_threshold_hash           constant numeric(18, 6) := 100;
    v_max_unclaimed_seconds  constant numeric           := 43200;   -- 12 годин
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
                set last_harvest_at = v_now,
                    lifetime_hash_generated = lifetime_hash_generated + v_row_harvested,
                    is_dead = true
                where id = v_gpu.id;
        else
            update public.user_gpus
                set last_harvest_at = v_now,
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

        -- Лише прапорець "реферал пройшов перший цикл" — БЕЗ грошового
        -- нарахування referrer'у (те, що раніше платилось тут, прибрано за
        -- проханням користувача; 5% з депозитів і 0.01 TON/1000 HASH обміну
        -- лишаються недоторканими в інших функціях).
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
