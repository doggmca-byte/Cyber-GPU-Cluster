-- =====================================================================================
-- Етап 5: TON Connect депозит + реферальна економіка (5% RevShare з депозиту,
-- 0.01 TON за перший видобуток referee) + адреса призначення при виводі.
--
-- Правило блокувань, щоб уникнути deadlock між функціями, що чіпають і referee,
-- і referrer (process_successful_deposit та harvest_user_hash):
--   1) СПОЧАТКУ лочимо профіль referee (викликача),
--   2) ПОТІМ профіль referrer (якщо є),
--   3) ПОТІМ рядок referrals.
-- Порядок однаковий у обох функціях, тому паралельні виклики для тієї самої
-- пари referee/referrer серіалізуються, а не тупикують.
--
-- Мутуальна пара (A реферить B і B реферить A) структурно неможлива, поки
-- profiles.referrer_id виставляється лише один раз при створенні профілю і
-- лише на вже існуючого referrer'а (див. app/api/user/sync/route.ts) — тому
-- достатньо цього єдиного порядку блокувань.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) Схема: lifetime_hash_generated (для порогу "referee згенерував >= 100 HASH
--    сумарно за весь час", незалежно від того, скільки з hash_balance вже витрачено),
--    tx_hash (replay-захист депозитів), новий тип транзакції.
-- ------------------------------------------------------------------------------------
alter table public.profiles
    add column lifetime_hash_generated numeric(18, 6) not null default 0
        check (lifetime_hash_generated >= 0);

alter table public.transactions
    add column tx_hash text;

create unique index transactions_tx_hash_uq
    on public.transactions (tx_hash)
    where tx_hash is not null;

alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim', 'referral_commission'
    ));

-- ------------------------------------------------------------------------------------
-- 2) process_successful_deposit — викликається лише після того, як бекенд
--    підтвердив реальну ончейн-транзакцію (app/api/wallet/deposit/verify).
--    Ідемпотентна за p_tx_hash: повторний виклик з тим самим хешем — помилка,
--    а не повторне нарахування.
-- ------------------------------------------------------------------------------------
create or replace function public.process_successful_deposit(
    p_user_id  uuid,
    p_amount   numeric(18, 6),
    p_tx_hash  text
)
returns table (
    game_balance      numeric(18, 6),
    withdrawal_quota  numeric(18, 6),
    transaction_id    uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    -- TODO: продуктові константи-заглушки, узгодити фінальні цифри окремо
    v_quota_bonus_rate  constant numeric(18, 6) := 1.5;   -- +150% від суми депозиту
    v_referral_rate      constant numeric(18, 6) := 0.05;  -- 5% RevShare рефереру

    v_referrer_id      uuid;
    v_transaction_id   uuid;
    v_referral_bonus   numeric(18, 6);
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'p_amount must be positive' using errcode = 'P0001';
    end if;

    if p_tx_hash is null or length(trim(p_tx_hash)) = 0 then
        raise exception 'p_tx_hash is required' using errcode = 'P0001';
    end if;

    -- replay-захист: якщо цей tx_hash уже оброблений — не нараховуємо вдруге.
    -- (унікальний індекс transactions_tx_hash_uq — це другий рубіж на випадок
    -- гонки двох паралельних verify-запитів з однаковим хешем)
    if exists (select 1 from public.transactions where tx_hash = p_tx_hash) then
        raise exception 'transaction % already processed', p_tx_hash using errcode = 'P0001';
    end if;

    -- 1) лочимо referee (викликача) першим
    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    update public.profiles as pr
        set game_balance = pr.game_balance + p_amount,
            withdrawal_quota = pr.withdrawal_quota + (p_amount * v_quota_bonus_rate)
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload, tx_hash)
    values (
        p_user_id,
        'deposit',
        p_amount,
        0,
        'completed',
        jsonb_build_object('quota_bonus', round(p_amount * v_quota_bonus_rate, 6)),
        p_tx_hash
    )
    returning id into v_transaction_id;

    -- 2) реферальна revshare 5% — лише якщо є referrer
    if v_referrer_id is not null then
        v_referral_bonus := round(p_amount * v_referral_rate, 6);

        -- лочимо referrer ДРУГИМ (стабільний порядок з harvest_user_hash)
        perform 1 from public.profiles where id = v_referrer_id for update;

        update public.referrals
            set pending_reward = pending_reward + v_referral_bonus,
                total_earned = total_earned + v_referral_bonus
            where referrer_id = v_referrer_id
              and referee_id = p_user_id;

        if found then
            insert into public.transactions (user_id, type, amount, fee, status, payload)
            values (
                v_referrer_id,
                'referral_commission',
                v_referral_bonus,
                0,
                'completed',
                jsonb_build_object(
                    'source', 'deposit_revshare',
                    'referee_id', p_user_id,
                    'deposit_tx_hash', p_tx_hash
                )
            );
        else
            -- узгодженості profiles.referrer_id і рядка referrals немає (напр.
            -- запис referrals не вдалось створити при sync) — не валимо депозит
            -- через це, лише лишаємо слід у логах
            raise notice 'referrals row missing for referrer % / referee % — revshare accrual skipped',
                v_referrer_id, p_user_id;
        end if;
    end if;

    return query
        select pr.game_balance, pr.withdrawal_quota, v_transaction_id
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 3) harvest_user_hash — додано реферальний бонус за перший видобуток:
--    коли lifetime_hash_generated referee перетинає поріг 100 HASH вперше,
--    referrer отримує фіксовані +0.01 TON у pending_reward.
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
        v_elapsed_seconds := greatest(extract(epoch from (v_now - v_gpu.last_harvest_at)), 0);
        v_row_harvested := round(v_elapsed_seconds * v_gpu.hash_per_second * v_gpu.amount, 6);
        v_total_harvested := v_total_harvested + v_row_harvested;

        update public.user_gpus
            set last_harvest_at = v_now
            where id = v_gpu.id;
    end loop;

    if v_total_harvested > 0 then
        update public.profiles as pr
            set hash_balance = pr.hash_balance + v_total_harvested,
                lifetime_hash_generated = pr.lifetime_hash_generated + v_total_harvested
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
-- 4) request_withdrawal: додано обов'язковий параметр адреси призначення.
--    Зміна сигнатури -> DROP старої версії перед CREATE (інакше лишиться
--    осиротілий 2-аргументний overload).
-- ------------------------------------------------------------------------------------
drop function if exists public.request_withdrawal(uuid, numeric);

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
    v_fee_bps           constant numeric  := 1000;  -- 10.00%
    v_min_ads_watched    constant integer         := 20;
    v_daily_limit_ton    constant numeric(18, 6)  := 100;

    v_profile          record;
    v_already_today    numeric(18, 6);
    v_fee              numeric(18, 6);
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

-- ------------------------------------------------------------------------------------
-- 5) Гранти: лише service_role. REVOKE ALL FROM PUBLIC обов'язково (двічі вже
--    забував це на попередніх етапах — тепер робимо одразу разом зі створенням).
-- ------------------------------------------------------------------------------------
revoke all on function public.process_successful_deposit(uuid, numeric, text) from public;
revoke all on function public.request_withdrawal(uuid, numeric, text) from public;

grant execute on function public.process_successful_deposit(uuid, numeric, text) to service_role;
grant execute on function public.request_withdrawal(uuid, numeric, text) to service_role;
