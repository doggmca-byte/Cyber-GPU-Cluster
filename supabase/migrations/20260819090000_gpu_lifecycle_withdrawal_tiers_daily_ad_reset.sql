-- =====================================================================================
-- Три подальші механіки за порівнянням з конкурентним FAQ (EcoForest-скрини, раунд 2):
--   1) GPU lifecycle + оживлення: агрегатно по (user, level) — кап = 1.25 × cost_ton ×
--      amount (у HASH-еквіваленті), 3 оживлення (75%/50%/25% від cost_ton × amount).
--   2) Тіньовані ліміти/комісії виводу: мінімум за номером заявки, максимум за сумою
--      lifetime-депозитів, комісія 0.03 → 0.05 → 10%, 1 заявка/добу UTC.
--   3) Щоденне (00:00 UTC) скидання ads_watched_since_withdraw — не лише після виводу.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) Схема
-- ------------------------------------------------------------------------------------
alter table public.user_gpus
    add column if not exists lifetime_hash_generated numeric(18, 6) not null default 0,
    add column if not exists is_dead                  boolean not null default false,
    add column if not exists revival_count             integer not null default 0
        check (revival_count between 0 and 3);

alter table public.profiles
    add column if not exists withdrawal_request_count  integer not null default 0,
    add column if not exists last_withdrawal_request_date date,
    add column if not exists lifetime_deposited_ton     numeric(18, 6) not null default 0,
    add column if not exists ads_quota_reset_date        date not null default ((now() at time zone 'utc')::date);

alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim', 'referral_commission', 'task_reward',
        'daily_bonus', 'revive_gpu'
    ));

-- ------------------------------------------------------------------------------------
-- 2) harvest_user_hash: той самий алгоритм (harvest_count + referral bonus + 12г кап),
--    плюс lifecycle-кап на РЯДОК (user, level): скільки HASH ще можна нарахувати цьому
--    рядку до v_lifecycle_cap = 1.25 × cost_ton × amount / HASH_TO_TON_RATE. Коли
--    досягнуто — is_dead := true, рядок далі НЕ нараховує (до revive_gpu). last_harvest_at
--    все одно скидається на v_now (як і при 12г капі — семантика та сама: "зупинилось",
--    а не "застрягло").
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
    v_first_harvest_bonus     constant numeric(18, 6) := 0.01;
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
            -- мертвий рядок не нараховує нічого, доки не оживлений — але
            -- last_harvest_at все одно не чіпаємо (нема сенсу: rewive_gpu сам
            -- скине його при оживленні).
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

        if v_referrer_id is not null and v_lifetime_hash >= v_threshold_hash then
            perform 1 from public.profiles where id = v_referrer_id for update;

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
-- 3) buy_gpu: той самий алгоритм, плюс блокування купівлі, поки рядок мертвий
--    (is_dead) — спершу revive_gpu, потім знову buy_gpu.
-- ------------------------------------------------------------------------------------
create or replace function public.buy_gpu(p_user_id uuid, p_level integer)
returns table (
    new_game_balance   numeric(18, 6),
    new_gpu_amount     integer,
    hash_harvested     numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_template          public.gpu_templates%rowtype;
    v_current_amount    integer := 0;
    v_is_dead           boolean := false;
    v_balance           numeric(18, 6);
    v_harvested         numeric(18, 6) := 0;
    v_new_amount        integer;
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    select game_balance into v_balance
        from public.profiles
        where id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select * into v_template
        from public.gpu_templates
        where level = p_level;

    if not found then
        raise exception 'gpu template level % not found', p_level using errcode = 'P0002';
    end if;

    select amount, is_dead into v_current_amount, v_is_dead
        from public.user_gpus
        where user_id = p_user_id
          and gpu_level = p_level
        for update;

    if not found then
        v_current_amount := 0;
        v_is_dead := false;
    end if;

    if v_is_dead then
        raise exception 'gpu level % is dead — revive it before buying more', p_level
            using errcode = 'P0001';
    end if;

    if v_current_amount >= v_template.max_limit then
        raise exception 'gpu level % purchase limit reached (% / %)',
            p_level, v_current_amount, v_template.max_limit
            using errcode = 'P0001';
    end if;

    if v_balance < v_template.cost_ton then
        raise exception 'insufficient game_balance: has %, needs %',
            v_balance, v_template.cost_ton
            using errcode = 'P0001';
    end if;

    update public.profiles
        set game_balance = game_balance - v_template.cost_ton
        where id = p_user_id
        returning game_balance into v_balance;

    v_harvested := public.harvest_user_hash(p_user_id);

    insert into public.user_gpus (user_id, gpu_level, amount, last_harvest_at)
    values (p_user_id, p_level, 1, clock_timestamp())
    on conflict (user_id, gpu_level)
        do update set amount = public.user_gpus.amount + 1
    returning amount into v_new_amount;

    return query select v_balance, v_new_amount, v_harvested;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 4) revive_gpu(p_user_id, p_level): оживляє мертвий рядок — знімає
--    cost_ton × amount × revival_multiplier(revival_count) з game_balance,
--    скидає lifetime_hash_generated/is_dead/last_harvest_at, +1 до revival_count.
--    Максимум 3 оживлення (revival_count вже перевіряється CHECK-констрейнтом
--    на самій колонці — тут явна дружня помилка ДО спроби UPDATE).
-- ------------------------------------------------------------------------------------
create or replace function public.revive_gpu(p_user_id uuid, p_level integer)
returns table (
    new_game_balance    numeric(18, 6),
    revival_count        integer,
    revival_cost          numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    -- lib/constants/economy.ts GPU_REVIVAL_COST_MULTIPLIERS — тримати синхронізовано.
    v_revival_multipliers constant numeric[] := array[0.75, 0.5, 0.25];
    v_template            public.gpu_templates%rowtype;
    v_gpu                 record;
    v_balance             numeric(18, 6);
    v_cost                numeric(18, 6);
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    select game_balance into v_balance
        from public.profiles
        where id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select * into v_template from public.gpu_templates where level = p_level;
    if not found then
        raise exception 'gpu template level % not found', p_level using errcode = 'P0002';
    end if;

    select id, amount, is_dead, revival_count into v_gpu
        from public.user_gpus
        where user_id = p_user_id
          and gpu_level = p_level
        for update;

    if not found or not v_gpu.is_dead then
        raise exception 'gpu level % is not dead — nothing to revive', p_level
            using errcode = 'P0001';
    end if;

    if v_gpu.revival_count >= 3 then
        raise exception 'gpu level % has no revivals left', p_level using errcode = 'P0001';
    end if;

    v_cost := round(
        v_template.cost_ton * v_gpu.amount * v_revival_multipliers[v_gpu.revival_count + 1],
        6
    );

    if v_balance < v_cost then
        raise exception 'insufficient game_balance: has %, needs %', v_balance, v_cost
            using errcode = 'P0001';
    end if;

    update public.profiles
        set game_balance = game_balance - v_cost
        where id = p_user_id
        returning game_balance into v_balance;

    update public.user_gpus
        set is_dead = false,
            lifetime_hash_generated = 0,
            last_harvest_at = clock_timestamp(),
            revival_count = revival_count + 1
        where id = v_gpu.id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id, 'revive_gpu', -v_cost, 0, 'completed',
        jsonb_build_object('gpu_level', p_level, 'revival_count', v_gpu.revival_count + 1)
    );

    return query select v_balance, v_gpu.revival_count + 1, v_cost;
end;
$$;

revoke all on function public.revive_gpu(uuid, integer) from public;
grant execute on function public.revive_gpu(uuid, integer) to authenticated, service_role;

-- ------------------------------------------------------------------------------------
-- 5) record_ad_watch: той самий алгоритм, плюс лінива щоденна (00:00 UTC) реінкарнація
--    ads_watched_since_withdraw — не лише після виводу. Якщо ads_quota_reset_date
--    "вчора чи раніше" відносно поточної UTC-дати — рахуємо з нуля ПЕРЕД інкрементом.
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
    v_quota_bonus constant numeric(18, 6) := 0.05;
    v_today       date := (now() at time zone 'utc')::date;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    update public.profiles as pr
        set ads_watched_since_withdraw =
                case when pr.ads_quota_reset_date < v_today then 1
                     else pr.ads_watched_since_withdraw + 1 end,
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

-- ------------------------------------------------------------------------------------
-- 6) process_successful_deposit: той самий алгоритм, плюс lifetime_deposited_ton
--    (потрібен request_withdrawal для тіньованого максимуму заявки).
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
    v_quota_bonus_rate  constant numeric(18, 6) := 1.5;
    v_referral_rate      constant numeric(18, 6) := 0.05;

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

    if exists (select 1 from public.transactions where tx_hash = p_tx_hash) then
        raise exception 'transaction % already processed', p_tx_hash using errcode = 'P0001';
    end if;

    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    update public.profiles as pr
        set game_balance = pr.game_balance + p_amount,
            withdrawal_quota = pr.withdrawal_quota + (p_amount * v_quota_bonus_rate),
            lifetime_deposited_ton = pr.lifetime_deposited_ton + p_amount
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

    if v_referrer_id is not null then
        v_referral_bonus := round(p_amount * v_referral_rate, 6);

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
-- 7) request_withdrawal: тіньовані мінімум/максимум/комісія + 1 заявка/добу UTC
--    (замість попереднього плоского sum-based ліміту 100 TON/24г) + лінива щоденна
--    реінкарнація ads_watched_since_withdraw (той самий принцип, що й у record_ad_watch
--    — навіть якщо гравець сюди прийшов "холодним", а не через WatchAdButton).
--
--    Тіри визначені НОМЕРОМ ЦІЄЇ заявки (withdrawal_request_count ДО інкременту):
--      0-ва заявка → мін 0.1, комісія 0.03 (флет)
--      1-ша заявка → мін 0.25, комісія 0.05 (флет)
--      2+          → мін 0.5,  комісія 10% (як і раніше)
--    Максимум за lifetime_deposited_ton: <5→1, 5-100→3, 100-250→7, 250+→15.
-- ------------------------------------------------------------------------------------
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
    v_min_ads_watched    constant integer  := 20;
    v_today               date := (now() at time zone 'utc')::date;

    v_profile          record;
    v_min_for_tier      numeric(18, 6);
    v_max_for_tier      numeric(18, 6);
    v_fee               numeric(18, 6);
    v_net_payout       numeric(18, 6);
    v_transaction_id   uuid;
    v_ads_watched       integer;
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

    -- лінива щоденна реінкарнація ad-квоти (той самий принцип, що й record_ad_watch)
    v_ads_watched := v_profile.ads_watched_since_withdraw;
    if v_profile.ads_quota_reset_date < v_today then
        v_ads_watched := 0;
    end if;

    if v_ads_watched < v_min_ads_watched then
        raise exception 'watch at least % ads before withdrawing (watched %)',
            v_min_ads_watched, v_ads_watched
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
