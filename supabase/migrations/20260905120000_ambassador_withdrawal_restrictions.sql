-- =====================================================================================
-- Обмеження виводу для амбасадорів (profiles.is_ambassador), за продуктовою угодою:
--
--   1) Cascading Withdrawals: амбасадор не може вивести більше 2 TON/добу —
--      тіньований максимум за заявку (v_max_for_tier, залежить від
--      lifetime_deposited_ton) додатково обрізається до 2 TON, якщо
--      is_ambassador = true. Ліміт "1 заявка/добу" вже є (незмінний), тож
--      "не більше 2 TON/добу" зводиться до "не більше 2 TON за ЦЮ заявку".
--
--   2) Performance Unlock + 3) Status Revocation: вивід розблоковується лише
--      після онбордингу мінімум 30 АКТИВНИХ рефералів — "активний" =
--      referrals.has_reached_threshold = true, той самий прапорець, що вже
--      виставляє harvest_user_hash, коли реферал реально пройшов свій ПЕРШИЙ
--      цикл збору (lifetime_hash_generated >= 100,
--      REFERRAL_FIRST_HARVEST_THRESHOLD_HASH) — жодного нового поняття
--      "активності" не вводимо, перевикористовуємо вже існуюче. Якщо на
--      момент ПЕРШОЇ спроби виводу (withdrawal_request_count = 0) мінімум не
--      набрано — is_ambassador одразу скидається в false (партнерство
--      розірвано), і сама заявка відхиляється.
--
--      ВАЖЛИВО (реальний баг, знайдений живим тестом на диспозабл-профілі):
--      не можна робити revoke-update і RAISE EXCEPTION в ОДНІЙ функції —
--      Postgres відкочує ВЕСЬ виклик функції разом із винятком, тобто
--      "is_ambassador = false" теж відкотився б і взагалі ніколи не
--      персистився. Тому перевірку/revoke винесено в ОКРЕМУ функцію
--      check_ambassador_withdrawal_gate — бекенд (app/api/wallet/withdraw)
--      викликає її ПЕРШИМ, окремим top-level RPC-викликом (власна транзакція,
--      комітиться незалежно від того, що станеться далі), і лише тоді, коли
--      вона повертає passed = true, викликає request_withdrawal. Сам
--      request_withdrawal онбординговий gate більше не перевіряє —
--      лишає тільки завжди-активний 2 TON/заявка кап для is_ambassador.
-- =====================================================================================

create or replace function public.check_ambassador_withdrawal_gate(p_user_id uuid)
returns table (
    passed              boolean,
    active_referrals    integer,
    required_referrals  integer,
    revoked             boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ambassador_min_active_refs constant integer := 30;
    v_is_ambassador     boolean;
    v_request_count     integer;
    v_active_referrals  integer;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    select pr.is_ambassador, pr.withdrawal_request_count
        into v_is_ambassador, v_request_count
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- Не амбасадор, або вже пройшов gate раніше (не перша спроба) — нема що перевіряти.
    if not v_is_ambassador or v_request_count > 0 then
        return query select true, null::integer, v_ambassador_min_active_refs, false;
        return;
    end if;

    select count(*) into v_active_referrals
        from public.referrals as r
        where r.referrer_id = p_user_id
          and r.has_reached_threshold = true;

    if v_active_referrals >= v_ambassador_min_active_refs then
        return query select true, v_active_referrals, v_ambassador_min_active_refs, false;
        return;
    end if;

    update public.profiles as pr
        set is_ambassador = false
        where pr.id = p_user_id;

    return query select false, v_active_referrals, v_ambassador_min_active_refs, true;
end;
$$;

revoke all on function public.check_ambassador_withdrawal_gate(uuid) from public, anon, authenticated;
grant execute on function public.check_ambassador_withdrawal_gate(uuid) to service_role;

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
    v_percent_fee_bps            constant numeric  := 1000;  -- 10.00%, завжди
    v_min_withdrawal             constant numeric  := 0.1;   -- завжди, незалежно від номера заявки
    v_ambassador_daily_cap       constant numeric  := 2;     -- TON, максимум за заявку для амбасадора
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
           pr.lifetime_deposited_ton, pr.is_ambassador
        into v_profile
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- Онбордингова перевірка/revoke амбасадора НЕ тут (див. коментар вгорі
    -- файлу) — виконана окремим RPC-викликом check_ambassador_withdrawal_gate
    -- ДО цього виклику. Якщо ми тут і профіль досі is_ambassador = true,
    -- значить gate або пройдено, або застосунок ще не встиг його викликати
    -- (тоді нижче все одно застосовується лише безпечний cap, без revoke).

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

    -- Cascading withdrawal cap: амбасадор ніколи не перевищує 2 TON за заявку
    -- (і лише 1 заявка/добу дозволена в принципі) — незалежно від того,
    -- наскільки вищий тір за lifetime_deposited_ton.
    if v_profile.is_ambassador then
        v_max_for_tier := least(v_max_for_tier, v_ambassador_daily_cap);
    end if;

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

-- CREATE OR REPLACE не скидає раніше видані гранти на цю сигнатуру
-- (service_role вже мав EXECUTE з попередніх міграцій) — повторний grant не потрібен.
