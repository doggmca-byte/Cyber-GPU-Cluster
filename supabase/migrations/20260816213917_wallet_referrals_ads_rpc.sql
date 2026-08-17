-- =====================================================================================
-- Етап 4: гаманець/виведення, реферальні виплати, конвертація балансів, перегляд реклами.
--
-- Усі нові RPC дотримуються того самого правила атомарності, що й в Етапі 1:
-- SELECT ... FOR UPDATE на profiles.id на самому початку функції як персональний
-- м'ютекс — жодна з цих функцій не може виконатись паралельно сама із собою чи
-- з harvest_user_hash / buy_gpu / exchange_hash_to_ton для того самого користувача.
--
-- Числові константи (комісії, ліміти, бонуси) позначені як TODO — це продуктові
-- рішення-заглушки, які варто винести в конфіг-таблицю і узгодити з бізнесом.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) transactions.type: додаємо 'referral_claim'
-- ------------------------------------------------------------------------------------
alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim'
    ));

-- ------------------------------------------------------------------------------------
-- 2) convert_withdrawable_to_game — зворотна конвертація TON 1:1,
--    мінімум 0.10 TON (Екран Обміну, картка №2)
-- ------------------------------------------------------------------------------------
create or replace function public.convert_withdrawable_to_game(
    p_user_id uuid,
    p_amount  numeric(18, 6)
)
returns table (
    withdrawable_balance numeric(18, 6),
    game_balance         numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_min_amount   constant numeric(18, 6) := 0.10;
    v_withdrawable numeric(18, 6);
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_amount is null or p_amount < v_min_amount then
        raise exception 'p_amount must be at least % TON', v_min_amount
            using errcode = 'P0001';
    end if;

    select withdrawable_balance into v_withdrawable
        from public.profiles
        where id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if v_withdrawable < p_amount then
        raise exception 'insufficient withdrawable_balance: has %, needs %',
            v_withdrawable, p_amount
            using errcode = 'P0001';
    end if;

    update public.profiles
        set withdrawable_balance = withdrawable_balance - p_amount,
            game_balance = game_balance + p_amount
        where id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'convert_balance', p_amount, 0, 'completed',
            jsonb_build_object('direction', 'withdrawable_to_game'));

    return query
        select p.withdrawable_balance, p.game_balance
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 3) request_withdrawal — заявка на вивід TON зі статусом 'pending'.
--    Кошти РЕЗЕРВУЮТЬСЯ одразу (списуються з withdrawable_balance), фактична
--    виплата — процес поза цією міграцією (адмін/воркер позначає transaction
--    'completed' або повертає кошти, позначивши 'failed'/'cancelled').
-- ------------------------------------------------------------------------------------
create or replace function public.request_withdrawal(
    p_user_id uuid,
    p_amount  numeric(18, 6)
)
returns table (
    transaction_id              uuid,
    requested_amount            numeric(18, 6),
    fee_charged                 numeric(18, 6),
    net_payout                  numeric(18, 6),
    withdrawable_balance        numeric(18, 6),
    withdrawal_quota            numeric(18, 6),
    ads_watched_since_withdraw  integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    -- TODO: продуктові константи-заглушки, узгодити фінальні цифри окремо
    v_fee_bps          constant numeric(9, 6)  := 1000;  -- 10.00%
    v_min_ads_watched   constant integer         := 20;
    v_daily_limit_ton   constant numeric(18, 6)  := 100;  -- сума заявок за останні 24г

    v_profile         record;
    v_already_today   numeric(18, 6);
    v_fee             numeric(18, 6);
    v_net_payout      numeric(18, 6);
    v_transaction_id  uuid;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'p_amount must be positive' using errcode = 'P0001';
    end if;

    select id, withdrawable_balance, withdrawal_quota, ads_watched_since_withdraw
        into v_profile
        from public.profiles
        where id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if v_profile.ads_watched_since_withdraw < v_min_ads_watched then
        raise exception 'watch at least % ads before withdrawing (watched %)',
            v_min_ads_watched, v_profile.ads_watched_since_withdraw
            using errcode = 'P0001';
    end if;

    if v_profile.withdrawable_balance < p_amount then
        raise exception 'insufficient withdrawable_balance: has %, needs %',
            v_profile.withdrawable_balance, p_amount
            using errcode = 'P0001';
    end if;

    if v_profile.withdrawal_quota < p_amount then
        raise exception 'insufficient withdrawal_quota: has %, needs % (watch more ads to unlock quota)',
            v_profile.withdrawal_quota, p_amount
            using errcode = 'P0001';
    end if;

    -- добовий ліміт: сума вже поданих (pending/completed) заявок за останні 24г
    select coalesce(sum(amount), 0) * -1 into v_already_today
        from public.transactions
        where user_id = p_user_id
          and type = 'withdraw'
          and status in ('pending', 'completed')
          and created_at >= now() - interval '24 hours';

    if v_already_today + p_amount > v_daily_limit_ton then
        raise exception 'daily withdrawal limit exceeded: already requested % TON today, limit % TON',
            v_already_today, v_daily_limit_ton
            using errcode = 'P0001';
    end if;

    v_fee := round(p_amount * v_fee_bps / 10000, 6);
    v_net_payout := p_amount - v_fee;

    update public.profiles
        set withdrawable_balance = withdrawable_balance - p_amount,
            withdrawal_quota = withdrawal_quota - p_amount,
            ads_watched_since_withdraw = 0
        where id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'withdraw',
        -p_amount,
        v_fee,
        'pending',
        jsonb_build_object('net_payout', v_net_payout)
    )
    returning id into v_transaction_id;

    return query
        select
            v_transaction_id,
            p_amount,
            v_fee,
            v_net_payout,
            p.withdrawable_balance,
            p.withdrawal_quota,
            p.ads_watched_since_withdraw
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 4) claim_referral_rewards — переказ pending_reward з усіх referrals цього
--    реферера на withdrawable_balance.
--
--    NB: сама логіка НАРАХУВАННЯ pending_reward (коли і скільки referrer отримує
--    з дій referee) в цьому етапі НЕ реалізована — жоден тригер/RPC поки не пише
--    в referrals.pending_reward. Ця функція лише коректно й атомарно забирає те,
--    що там уже накопичено. Будь-яка майбутня функція нарахування комісії теж
--    повинна починатися з SELECT profiles ... FOR UPDATE на referrer_id, щоб не
--    конфліктувати з паралельним claim.
-- ------------------------------------------------------------------------------------
create or replace function public.claim_referral_rewards(p_user_id uuid)
returns table (
    claimed_amount        numeric(18, 6),
    withdrawable_balance  numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_total_pending numeric(18, 6) := 0;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    -- персональний м'ютекс отримувача виплати
    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- блокуємо всі referral-рядки з ненульовим pending_reward перед підрахунком
    perform 1 from public.referrals
        where referrer_id = p_user_id and pending_reward > 0
        for update;

    select coalesce(sum(pending_reward), 0) into v_total_pending
        from public.referrals
        where referrer_id = p_user_id;

    if v_total_pending <= 0 then
        raise exception 'nothing to claim' using errcode = 'P0001';
    end if;

    update public.referrals
        set total_earned = total_earned + pending_reward,
            pending_reward = 0
        where referrer_id = p_user_id
          and pending_reward > 0;

    update public.profiles
        set withdrawable_balance = withdrawable_balance + v_total_pending
        where id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'referral_claim', v_total_pending, 0, 'completed',
            jsonb_build_object('source', 'referral_commission'));

    return query
        select v_total_pending, p.withdrawable_balance
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 5) record_ad_watch — фіксація перегляду реклами (Adsgram-заглушка):
--    +1 до ads_watched_since_withdraw, бонус до withdrawal_quota.
--    Проста одна UPDATE-заява — атомарна сама собою (без потреби в FOR UPDATE).
-- ------------------------------------------------------------------------------------
create or replace function public.record_ad_watch(p_user_id uuid)
returns table (
    ads_watched_since_withdraw integer,
    withdrawal_quota           numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    -- TODO: продуктова константа-заглушка (бонус квоти за 1 перегляд реклами)
    v_quota_bonus constant numeric(18, 6) := 0.05;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    update public.profiles
        set ads_watched_since_withdraw = ads_watched_since_withdraw + 1,
            withdrawal_quota = withdrawal_quota + v_quota_bonus
        where id = p_user_id;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    return query
        select p.ads_watched_since_withdraw, p.withdrawal_quota
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 6) Гранти: лише service_role (Supabase інакше автоматично видає EXECUTE
--    anon/authenticated через ALTER DEFAULT PRIVILEGES — див. коментар у
--    20260816205809_restrict_rpc_to_service_role.sql).
-- ------------------------------------------------------------------------------------
revoke execute on function public.convert_withdrawable_to_game(uuid, numeric) from anon, authenticated;
revoke execute on function public.request_withdrawal(uuid, numeric) from anon, authenticated;
revoke execute on function public.claim_referral_rewards(uuid) from anon, authenticated;
revoke execute on function public.record_ad_watch(uuid) from anon, authenticated;

grant execute on function public.convert_withdrawable_to_game(uuid, numeric) to service_role;
grant execute on function public.request_withdrawal(uuid, numeric) to service_role;
grant execute on function public.claim_referral_rewards(uuid) to service_role;
grant execute on function public.record_ad_watch(uuid) to service_role;
