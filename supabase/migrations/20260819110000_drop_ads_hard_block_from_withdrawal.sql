-- Знімаємо обов'язкове блокування виводу переглядом реклами (20/20).
-- ads_watched_since_withdraw лишається як лічильник для WatchAdButton/
-- record_ad_watch (кожен перегляд усе одно додає +0.05 TON до
-- withdrawal_quota — реальний ефект нікуди не подівся), просто більше НЕ
-- є hard-blocker'ом самого запиту на вивід. Реальні перевірки, що
-- лишаються: withdrawable_balance, withdrawal_quota, тіньований мін/макс
-- за номером заявки/lifetime-депозитами, 1 заявка/добу UTC, валідна адреса
-- (адреса перевіряється на клієнті/в роуті, не тут).

create or replace function public.request_withdrawal(
    p_user_id              uuid,
    p_amount               numeric(18, 6),
    p_destination_address  text
)
returns table (
    transaction_id              uuid,
    requested_amount            numeric(18, 6),
    fee_charged                 numeric(18, 6),
    net_payout                  numeric(18, 6),
    destination_address         text,
    withdrawable_balance        numeric(18, 6),
    withdrawal_quota            numeric(18, 6),
    ads_watched_since_withdraw  integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_percent_fee_bps    constant numeric  := 1000;  -- 10.00%, з 3-ї заявки
    v_today               date := (now() at time zone 'utc')::date;

    v_profile          record;
    v_min_for_tier      numeric(18, 6);
    v_max_for_tier      numeric(18, 6);
    v_fee               numeric(18, 6);
    v_net_payout       numeric(18, 6);
    v_transaction_id   uuid;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'p_amount must be positive' using errcode = 'P0001';
    end if;

    if p_destination_address is null or length(trim(p_destination_address)) = 0 then
        raise exception 'p_destination_address is required' using errcode = 'P0001';
    end if;

    select pr.id, pr.withdrawable_balance, pr.withdrawal_quota, pr.ads_watched_since_withdraw,
           pr.ads_quota_reset_date, pr.withdrawal_request_count, pr.last_withdrawal_request_date,
           pr.lifetime_deposited_ton
        into v_profile
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
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

    if v_profile.last_withdrawal_request_date is not null
       and v_profile.last_withdrawal_request_date = v_today
    then
        raise exception 'only 1 withdrawal request per UTC day is allowed' using errcode = 'P0001';
    end if;

    v_min_for_tier := case v_profile.withdrawal_request_count
        when 0 then 0.1
        when 1 then 0.25
        else 0.5
    end;

    if p_amount < v_min_for_tier then
        raise exception 'minimum withdrawal for this request is % TON', v_min_for_tier
            using errcode = 'P0001';
    end if;

    v_max_for_tier := case
        when v_profile.lifetime_deposited_ton < 5   then 1
        when v_profile.lifetime_deposited_ton < 100 then 3
        when v_profile.lifetime_deposited_ton < 250 then 7
        else 15
    end;

    if p_amount > v_max_for_tier then
        raise exception 'maximum withdrawal per request is currently % TON (deposit more to raise it)',
            v_max_for_tier
            using errcode = 'P0001';
    end if;

    v_fee := case v_profile.withdrawal_request_count
        when 0 then 0.03
        when 1 then 0.05
        else round(p_amount * v_percent_fee_bps / 10000, 6)
    end;
    v_net_payout := p_amount - v_fee;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance - p_amount,
            withdrawal_quota = pr.withdrawal_quota - p_amount,
            ads_watched_since_withdraw = 0,
            ads_quota_reset_date = v_today,
            withdrawal_request_count = pr.withdrawal_request_count + 1,
            last_withdrawal_request_date = v_today
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'withdraw',
        -p_amount,
        v_fee,
        'pending',
        jsonb_build_object('net_payout', v_net_payout, 'destination_address', p_destination_address)
    )
    returning id into v_transaction_id;

    return query
        select
            v_transaction_id,
            p_amount,
            v_fee,
            v_net_payout,
            p_destination_address,
            p.withdrawable_balance,
            p.withdrawal_quota,
            p.ads_watched_since_withdraw
        from public.profiles p
        where p.id = p_user_id;
end;
$$;
