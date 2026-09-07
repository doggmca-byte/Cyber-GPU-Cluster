-- =====================================================================================
-- Бездепозитний вивід: рівно ОДИН за весь час, рівно на мінімальну суму.
--
--   1) Користувач БЕЗ депозиту може вивести один-єдиний раз і рівно
--      v_min_withdrawal (0.1 TON) — раніше тір "lifetime_deposited_ton < 5"
--      дозволяв йому до 1 TON за заявку і скільки завгодно заявок (по одній
--      на добу), що й було дірою в економіці.
--   2) Після цієї однієї заявки будь-яка наступна відхиляється з явною
--      вимогою зробити депозит від v_min_deposit (0.3 TON, MIN_DEPOSIT_TON
--      у lib/constants/economy.ts). Клієнт (WithdrawModal) показує це ще до
--      сабміту й локалізовано, сервер — джерело правди й backstop.
--   3) Правило НЕ стосується тих, хто вже вніс депозит (lifetime_deposited_ton
--      >= v_min_deposit) — у них усе як було, звичайні тіри за сумою
--      депозитів. На момент міграції таких 15, і в жодного з них немає
--      депозиту МЕНШЕ мінімального (перевірено запитом до продакшн-БД), тож
--      поріг ">= мінімального депозиту" нікого з наявних депозиторів не
--      зачіпає, а на майбутнє прибирає обхід через "пиловий" депозит на
--      0.001 TON.
--   4) Правило НЕ стосується амбасадорів (is_ambassador) — у них власний
--      режим: кап 2 TON/заявку (20260905120000_ambassador_withdrawal_restrictions.sql)
--      і ручна перевірка адміном, депозит для виводу не потрібен.
--
-- Решта логіки (комісія 10%, 1 заявка/добу UTC, квота, тіри максимуму за
-- lifetime-депозитами, скидання ads_watched_since_withdraw) — без змін.
-- =====================================================================================

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
    v_min_withdrawal             constant numeric  := 0.1;   -- мінімум будь-якої заявки
    v_ambassador_daily_cap       constant numeric  := 2;     -- кап заявки для is_ambassador
    v_min_deposit                constant numeric  := 0.3;   -- MIN_DEPOSIT_TON, поріг "депозит зроблено"
    v_today               date := (now() at time zone 'utc')::date;

    v_profile          record;
    v_needs_deposit     boolean;
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

    -- Бездепозитний режим: ані амбасадор, ані депозитор.
    v_needs_deposit := not v_profile.is_ambassador
                       and v_profile.lifetime_deposited_ton < v_min_deposit;

    -- Перевіряємо ПЕРШОЮ (ще до балансу/квоти/суми), щоб повідомлення було
    -- детермінованим: "зроби депозит", а не випадкове "недостатньо квоти"
    -- залежно від того, що юзер увів у поле.
    if v_needs_deposit and v_profile.withdrawal_request_count >= 1 then
        raise exception
            'a minimum deposit of % TON is required for further withdrawals (the single no-deposit withdrawal has already been used)',
            v_min_deposit
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

    -- Єдиний бездепозитний вивід — рівно на мінімум (0.1 TON), не більше.
    if v_needs_deposit then
        v_max_for_tier := least(v_max_for_tier, v_min_withdrawal);
    end if;

    -- Cascading withdrawal cap: амбасадор ніколи не перевищує 2 TON за заявку
    -- (і так лише 1 заявка/добу) — незалежно від тіра за депозитами.
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

-- CREATE OR REPLACE зберігає раніше видані гранти на цю сигнатуру
-- (service_role уже має EXECUTE) — повторний grant не потрібен.
