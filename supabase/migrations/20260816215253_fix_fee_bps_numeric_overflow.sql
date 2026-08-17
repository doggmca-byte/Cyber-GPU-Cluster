-- =====================================================================================
-- Виправлення знайденого live smoke-тестом бага: v_fee_bps було оголошено як
-- numeric(9,6) — це лише 3 цифри цілої частини (максимум 999.999999).
-- request_withdrawal використовував значення 1000 (10.00% у базисних пунктах),
-- що не влазить у numeric(9,6) -> "numeric field overflow" на кожному виклику.
--
-- exchange_hash_to_ton мала таке саме крихке оголошення (v_fee_bps := 200,
-- випадково влазило, але межа була лише в 5 кроках від переповнення) —
-- виправлено на необмежений numeric про всяк випадок / майбутнє тюнінгування.
-- =====================================================================================

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
    v_fee_bps          constant numeric  := 1000;  -- 10.00%
    v_min_ads_watched   constant integer         := 20;
    v_daily_limit_ton   constant numeric(18, 6)  := 100;

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

    select pr.id, pr.withdrawable_balance, pr.withdrawal_quota, pr.ads_watched_since_withdraw
        into v_profile
        from public.profiles pr
        where pr.id = p_user_id
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

    select coalesce(sum(t.amount), 0) * -1 into v_already_today
        from public.transactions t
        where t.user_id = p_user_id
          and t.type = 'withdraw'
          and t.status in ('pending', 'completed')
          and t.created_at >= now() - interval '24 hours';

    if v_already_today + p_amount > v_daily_limit_ton then
        raise exception 'daily withdrawal limit exceeded: already requested % TON today, limit % TON',
            v_already_today, v_daily_limit_ton
            using errcode = 'P0001';
    end if;

    v_fee := round(p_amount * v_fee_bps / 10000, 6);
    v_net_payout := p_amount - v_fee;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance - p_amount,
            withdrawal_quota = pr.withdrawal_quota - p_amount,
            ads_watched_since_withdraw = 0
        where pr.id = p_user_id;

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
        update public.profiles as pr
            set hash_balance = pr.hash_balance - p_hash_amount,
                withdrawable_balance = pr.withdrawable_balance + v_ton_net
            where pr.id = p_user_id;
    else
        update public.profiles as pr
            set hash_balance = pr.hash_balance - p_hash_amount,
                game_balance = pr.game_balance + v_ton_net
            where pr.id = p_user_id;
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
