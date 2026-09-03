-- Баг, знайдений за скаргою реального юзера (telegram_id 7803187609):
-- дивився 20 реклам 2026-08-31, спробував вивести пізніше — сервер
-- відмовив "watch at least 20 ads (watched 0)", хоча в БД реально
-- зберігалось ads_watched_since_withdraw = 20.
--
-- Причина: record_ad_watch/request_withdrawal трактували
-- ads_watched_since_withdraw як ЩОДЕННИЙ лічильник (скидали в 0/1, якщо
-- ads_quota_reset_date < сьогодні) — та сама "лінива реінкарнація", що
-- коректна для partner_ads_watched_today (СПРАВДІ денний ліміт), але
-- помилково скопійована сюди. Сама назва колонки ("since_withdraw", не
-- "today") і коментар у WithdrawModal.tsx ("Перегляд реклами більше НЕ
-- блокує вивід — лишається лише як інформативний прогрес/бонус до квоти")
-- прямо кажуть: це має бути монотонний лічильник "з часу останнього
-- виводу", що ніколи не згасає сам по собі, лише скидається в 0 при
-- РЕАЛЬНОМУ успішному виводі (що request_withdrawal і так уже робить).
--
-- Другий шар того самого бага: request_withdrawal досі жорстко БЛОКУВАВ
-- заявку винятком, якщо лічильник < 20 — хоча клієнт (WithdrawModal.tsx)
-- вже давно НЕ вважає це блокером у власному canSubmit. Сервер і клієнт
-- розійшлись: юзер бачив кнопку доступною, а сабміт падав з помилкою.
-- Прибираємо жорсткий блок на сервері теж, щоб збігалось з реальною
-- поведінкою клієнта — ads_watched_since_withdraw лишається суто
-- інформативним прогресом/бонусом до withdrawal_quota (+0.05 TON за
-- перегляд), а не hard-gate.

create or replace function public.record_ad_watch(p_user_id uuid)
returns table (
    ads_watched_since_withdraw integer,
    withdrawal_quota           numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_quota_bonus constant numeric(18, 6) := 0.05;
    v_today       date := (now() at time zone 'utc')::date;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    update public.profiles as pr
        set ads_watched_since_withdraw = pr.ads_watched_since_withdraw + 1,
            ads_quota_reset_date = v_today,
            withdrawal_quota = pr.withdrawal_quota + v_quota_bonus
        where pr.id = p_user_id;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    return query
        select p.ads_watched_since_withdraw, p.withdrawal_quota
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

create or replace function public.request_withdrawal(
    p_user_id uuid,
    p_amount numeric,
    p_destination_address text
)
returns table (
    transaction_id             uuid,
    requested_amount           numeric,
    fee_charged                numeric,
    net_payout                 numeric,
    destination_address        text,
    withdrawable_balance       numeric,
    withdrawal_quota           numeric,
    ads_watched_since_withdraw integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_percent_fee_bps    constant numeric  := 1000;  -- 10.00%, завжди
    v_min_withdrawal     constant numeric  := 0.1;   -- завжди, незалежно від номера заявки
    v_today               date := (now() at time zone 'utc')::date;

    v_profile          record;
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

    -- ads_watched_since_withdraw НЕ блокує вивід (той самий принцип, що вже
    -- в WithdrawModal.tsx canSubmit) — лишається лише інформативним
    -- прогресом/джерелом бонусу withdrawal_quota, більше жодної перевірки
    -- тут навмисно немає.

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

    if p_amount < v_min_withdrawal then
        raise exception 'minimum withdrawal for this request is % TON', v_min_withdrawal
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

    v_fee := round(p_amount * v_percent_fee_bps / 10000, 6);
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
