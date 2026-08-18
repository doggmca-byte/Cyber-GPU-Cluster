-- =====================================================================================
-- Три механіки за прямим порівнянням із конкурентним FAQ (EcoForest-скрини):
--   1) Welcome-бонус новим гравцям: 0.25 TON стартового game_balance.
--   2) 12-годинний кап на накопичення $HASH без харвесту ("production paused").
--   3) exchange_hash_to_ton: сума обміну має бути кратна 1000 HASH (не лише >=1000).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) Welcome-бонус — змінюємо DEFAULT, а не одноразовий INSERT-скрипт: єдиний
--    легітимний шлях створення профілю — app/api/user/sync/route.ts, і його INSERT
--    НЕ передає game_balance явно (покладається на DEFAULT), тож зміна дефолту
--    покриває реєстрацію без жодних правок Next.js-коду.
-- ------------------------------------------------------------------------------------
alter table public.profiles
    alter column game_balance set default 0.25;

-- ------------------------------------------------------------------------------------
-- 2) harvest_user_hash: той самий алгоритм, що й у 20260817140000_task_center.sql
--    (harvest_count + referral first-harvest bonus), плюс кап v_max_unclaimed_seconds
--    (12 год) на v_elapsed_seconds ПО КОЖНІЙ картці окремо. last_harvest_at все одно
--    скидається на v_now — "виробництво зупиняється" саме в сенсі "далі накопичення
--    не рахується", а не в сенсі "застрягає" (наступний харвест знову рахує з нуля).
--
--    ВАЖЛИВО для консистентності з клієнтом: hooks/useMiningEngine.ts і
--    components/farm/FarmScreen.tsx повторюють ЦЮ Ж формулу
--    (least(elapsed, MAX_UNCLAIMED_SECONDS)) під час прев'ю — інакше великий
--    лічильник показував би більше, ніж сервер реально нарахує при харвесті (клас
--    бага, який уже раз ловили — "HASH counter jump on harvest").
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
    v_gpu                      record;
    v_referrer_id              uuid;
    v_lifetime_hash            numeric(18, 6);
    -- TODO: продуктові константи-заглушки, узгодити фінальні цифри окремо
    v_first_harvest_bonus     constant numeric(18, 6) := 0.01;
    v_threshold_hash           constant numeric(18, 6) := 100;
    -- lib/constants/economy.ts MAX_UNCLAIMED_SECONDS — тримати синхронізовано вручну.
    v_max_unclaimed_seconds  constant numeric           := 43200;  -- 12 годин
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    -- 1) лочимо referee (викликача) першим — той самий порядок, що й
    -- у process_successful_deposit, щоб уникнути deadlock
    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    for v_gpu in
        select ug.id, ug.amount, ug.last_harvest_at, gt.hash_per_second
        from public.user_gpus ug
        join public.gpu_templates gt on gt.level = ug.gpu_level
        where ug.user_id = p_user_id
          and ug.amount > 0
        order by ug.id
        for update of ug
    loop
        v_elapsed_seconds := least(
            greatest(extract(epoch from (v_now - v_gpu.last_harvest_at)), 0),
            v_max_unclaimed_seconds
        );
        v_row_harvested := round(v_elapsed_seconds * v_gpu.hash_per_second * v_gpu.amount, 6);
        v_total_harvested := v_total_harvested + v_row_harvested;

        update public.user_gpus
            set last_harvest_at = v_now
            where id = v_gpu.id;
    end loop;

    if v_total_harvested > 0 then
        update public.profiles as pr
            set hash_balance = pr.hash_balance + v_total_harvested,
                lifetime_hash_generated = pr.lifetime_hash_generated + v_total_harvested,
                harvest_count = pr.harvest_count + 1
            where pr.id = p_user_id
            returning pr.lifetime_hash_generated into v_lifetime_hash;

        if v_referrer_id is not null and v_lifetime_hash >= v_threshold_hash then
            -- 2) лочимо referrer ДРУГИМ
            perform 1 from public.profiles where id = v_referrer_id for update;

            -- 3) і лише тепер рядок referrals — атомарно перевіряємо й одразу
            -- перемикаємо прапорець, щоб виключити подвійне нарахування при
            -- паралельних harvest-викликах цього ж referee
            update public.referrals
                set has_reached_threshold = true,
                    pending_reward = pending_reward + v_first_harvest_bonus,
                    total_earned = total_earned + v_first_harvest_bonus
                where referrer_id = v_referrer_id
                  and referee_id = p_user_id
                  and has_reached_threshold = false;

            if found then
                insert into public.transactions (user_id, type, amount, fee, status, payload)
                values (
                    v_referrer_id,
                    'referral_commission',
                    v_first_harvest_bonus,
                    0,
                    'completed',
                    jsonb_build_object('source', 'harvest_threshold', 'referee_id', p_user_id)
                );
            end if;
        end if;
    end if;

    return v_total_harvested;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 3) exchange_hash_to_ton: той самий алгоритм, що й у
--    20260816215253_fix_fee_bps_numeric_overflow.sql, плюс перевірка кратності
--    v_step (1000 HASH) — раніше приймався будь-який p_hash_amount >= 1000.
-- ------------------------------------------------------------------------------------
create or replace function public.exchange_hash_to_ton(
    p_user_id           uuid,
    p_hash_amount       numeric(18, 6),
    p_target_balance    text
)
returns table (
    hash_balance            numeric(18, 6),
    game_balance            numeric(18, 6),
    withdrawable_balance    numeric(18, 6),
    ton_credited            numeric(18, 6),
    fee_charged             numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_rate            constant numeric(18, 6) := 0.00001;
    v_min_hash        constant numeric(18, 6) := 1000;
    v_step            constant numeric(18, 6) := 1000;
    v_fee_bps         constant numeric  := 200;
    v_hash_balance    numeric(18, 6);
    v_ton_gross       numeric(18, 6);
    v_fee             numeric(18, 6) := 0;
    v_ton_net         numeric(18, 6);
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_hash_amount is null or p_hash_amount < v_min_hash then
        raise exception 'p_hash_amount must be at least % HASH', v_min_hash
            using errcode = 'P0001';
    end if;

    if mod(p_hash_amount, v_step) <> 0 then
        raise exception 'p_hash_amount must be a multiple of % HASH', v_step
            using errcode = 'P0001';
    end if;

    if p_target_balance not in ('withdrawable_balance', 'game_balance') then
        raise exception 'invalid p_target_balance: %', p_target_balance;
    end if;

    select pr.hash_balance into v_hash_balance
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if v_hash_balance < p_hash_amount then
        raise exception 'insufficient hash_balance: has %, needs %',
            v_hash_balance, p_hash_amount
            using errcode = 'P0001';
    end if;

    v_ton_gross := round(p_hash_amount * v_rate, 6);

    if p_target_balance = 'withdrawable_balance' then
        v_fee := round(v_ton_gross * v_fee_bps / 10000, 6);
    end if;

    v_ton_net := v_ton_gross - v_fee;

    if p_target_balance = 'withdrawable_balance' then
        update public.profiles
            set hash_balance = hash_balance - p_hash_amount,
                withdrawable_balance = withdrawable_balance + v_ton_net
            where id = p_user_id;
    else
        update public.profiles
            set hash_balance = hash_balance - p_hash_amount,
                game_balance = game_balance + v_ton_net
            where id = p_user_id;
    end if;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'exchange_hash',
        v_ton_net,
        v_fee,
        'completed',
        jsonb_build_object(
            'hash_spent', p_hash_amount,
            'target_balance', p_target_balance,
            'rate', v_rate
        )
    );

    return query
        select p.hash_balance, p.game_balance, p.withdrawable_balance, v_ton_net, v_fee
        from public.profiles p
        where p.id = p_user_id;
end;
$$;
