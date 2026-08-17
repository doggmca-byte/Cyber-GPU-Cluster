-- =====================================================================================
-- Cyber GPU Cluster — базова схема + атомарні RPC-функції
-- =====================================================================================
-- Мета: унеможливити гонки балансів (race conditions) при паралельних викликах
-- (harvest / buy_gpu / exchange) для одного й того самого користувача.
--
-- Стратегія атомарності:
--   1. Кожна RPC-функція виконується в межах ОДНІЄЇ транзакції (стандартна поведінка
--      виклику функції в Postgres) — усе застосовується або нічого.
--   2. На самому початку кожної функції рядок profiles цього user_id блокується
--      через `SELECT ... FOR UPDATE`. Це працює як персональний м'ютекс: будь-який
--      інший паралельний виклик (harvest_user_hash / buy_gpu / exchange_hash_to_ton)
--      для ТОГО САМОГО user_id змушений чекати, поки перша транзакція не завершиться
--      (COMMIT/ROLLBACK), і лише тоді читає вже оновлені значення балансів.
--   3. Рядки user_gpus, з якими працює функція, теж блокуються через FOR UPDATE
--      (в стабільному порядку — ORDER BY id), щоб виключити lost update при харвесті.
--   4. Прямий UPDATE/INSERT/DELETE із клієнта на ці таблиці заборонений через RLS —
--      єдиний легітимний шлях зміни балансу це SECURITY DEFINER RPC нижче.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
-- 1. ТАБЛИЦІ
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------------------------
create table if not exists public.profiles (
    id                            uuid primary key default gen_random_uuid(),
    telegram_id                   bigint not null unique,
    username                      text,
    first_name                    text,

    -- ігрова валюта (TON-номінал усередині гри, не виводиться напряму)
    game_balance                  numeric(18, 6) not null default 0,
    -- баланс, доступний до реального виводу (TON)
    withdrawable_balance          numeric(18, 6) not null default 0,
    -- накопичений $HASH
    hash_balance                  numeric(18, 6) not null default 0,

    -- квота на вивід (наприклад, ліміт TON, розблокований переглядом реклами)
    withdrawal_quota              numeric(18, 6) not null default 0,
    ads_watched_since_withdraw    integer not null default 0,

    referrer_id                   uuid references public.profiles (id) on delete set null,

    created_at                    timestamptz not null default now(),

    constraint profiles_game_balance_nonneg check (game_balance >= 0),
    constraint profiles_withdrawable_balance_nonneg check (withdrawable_balance >= 0),
    constraint profiles_hash_balance_nonneg check (hash_balance >= 0),
    constraint profiles_withdrawal_quota_nonneg check (withdrawal_quota >= 0),
    constraint profiles_ads_watched_nonneg check (ads_watched_since_withdraw >= 0),
    constraint profiles_referrer_not_self check (referrer_id is distinct from id)
);

create index if not exists idx_profiles_referrer_id on public.profiles (referrer_id);

-- ------------------------------------------------------------------------------------
-- gpu_templates — каталог карток (довідник, редагується адміном/service_role)
-- ------------------------------------------------------------------------------------
create table if not exists public.gpu_templates (
    level             integer primary key check (level between 1 and 10),
    name              text not null,
    rarity            text not null,
    cost_ton          numeric(18, 6) not null check (cost_ton > 0),
    hash_per_second   numeric(18, 6) not null check (hash_per_second >= 0),
    -- максимальна кількість одиниць цього рівня на одного користувача
    max_limit         integer not null default 10 check (max_limit > 0)
);

-- ------------------------------------------------------------------------------------
-- user_gpus — куплене обладнання користувача (по одному рядку на рівень)
-- ------------------------------------------------------------------------------------
create table if not exists public.user_gpus (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.profiles (id) on delete cascade,
    gpu_level         integer not null references public.gpu_templates (level),
    amount            integer not null default 0 check (amount >= 0),
    last_harvest_at   timestamptz not null default now(),

    constraint user_gpus_user_level_uq unique (user_id, gpu_level)
);

create index if not exists idx_user_gpus_user_id on public.user_gpus (user_id);

-- ------------------------------------------------------------------------------------
-- transactions — журнал усіх грошових операцій
-- ------------------------------------------------------------------------------------
create table if not exists public.transactions (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.profiles (id) on delete cascade,
    type          text not null check (type in ('deposit', 'withdraw', 'exchange_hash', 'convert_balance')),
    amount        numeric(18, 6) not null,
    fee           numeric(18, 6) not null default 0 check (fee >= 0),
    status        text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
    payload       jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create index if not exists idx_transactions_user_id_created_at
    on public.transactions (user_id, created_at desc);

-- ------------------------------------------------------------------------------------
-- referrals
-- ------------------------------------------------------------------------------------
create table if not exists public.referrals (
    id                       uuid primary key default gen_random_uuid(),
    referrer_id              uuid not null references public.profiles (id) on delete cascade,
    referee_id               uuid not null references public.profiles (id) on delete cascade,
    has_reached_threshold    boolean not null default false,
    pending_reward           numeric(18, 6) not null default 0 check (pending_reward >= 0),
    total_earned             numeric(18, 6) not null default 0 check (total_earned >= 0),
    created_at               timestamptz not null default now(),

    constraint referrals_referee_uq unique (referee_id),
    constraint referrals_not_self check (referrer_id <> referee_id)
);

create index if not exists idx_referrals_referrer_id on public.referrals (referrer_id);

-- =====================================================================================
-- 2. ROW LEVEL SECURITY
-- =====================================================================================
-- Усі таблиці з балансами закриті на прямий запис з клієнта. Єдиний легітимний шлях
-- змінити game_balance / withdrawable_balance / hash_balance / user_gpus — це виклик
-- SECURITY DEFINER RPC нижче (вони виконуються від імені власника функції і тому
-- обходять RLS незалежно від ролі викликача).
--
-- Політики SELECT навмисно не додані тут, бо Telegram Mini App зазвичай ходить у
-- Supabase через власний backend із service_role ключем (RLS для service_role не діє),
-- а не напряму з клієнта через anon/authenticated JWT. Якщо у вас є кастомний JWT з
-- profile_id, розкоментуйте приклад нижче під ваш auth-флоу.

alter table public.profiles       enable row level security;
alter table public.gpu_templates  enable row level security;
alter table public.user_gpus      enable row level security;
alter table public.transactions   enable row level security;
alter table public.referrals      enable row level security;

-- прайс-лист карток можна читати всім
create policy gpu_templates_select_all
    on public.gpu_templates
    for select
    using (true);

-- приклад (вимкнено): дозволити користувачу бачити лише власний профіль,
-- якщо profile_id прокинутий у кастомний JWT claim через ваш backend/edge-function.
-- create policy profiles_select_own
--     on public.profiles
--     for select
--     using (id = (auth.jwt() ->> 'profile_id')::uuid);

-- =====================================================================================
-- 3. АТОМАРНІ RPC-ФУНКЦІЇ
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- harvest_user_hash(p_user_id)
--   Розраховує $HASH, нарахований з моменту last_harvest_at по кожній одиниці
--   обладнання, додає суму на hash_balance і одразу скидає таймер. Усе — в одному
--   блокуванні рядка profiles, тож два паралельні виклики для одного user_id ніколи
--   не порахують один і той самий проміжок часу двічі.
-- ------------------------------------------------------------------------------------
create or replace function public.harvest_user_hash(p_user_id uuid)
returns numeric(18, 6)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now               timestamptz := clock_timestamp();
    v_total_harvested   numeric(18, 6) := 0;
    v_elapsed_seconds    numeric;
    v_row_harvested      numeric(18, 6);
    v_gpu                record;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    -- персональний м'ютекс: блокуємо профіль до кінця транзакції
    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    -- блокуємо всі рядки обладнання користувача в стабільному порядку (ORDER BY id),
    -- щоб уникнути lost update при конкурентному харвесті/купівлі
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
        update public.profiles
            set hash_balance = hash_balance + v_total_harvested
            where id = p_user_id;
    end if;

    return v_total_harvested;
end;
$$;

revoke all on function public.harvest_user_hash(uuid) from public;
grant execute on function public.harvest_user_hash(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------------------
-- buy_gpu(p_user_id, p_level)
--   Порядок точно за ТЗ: перевірка балансу -> перевірка ліміту -> списання коштів ->
--   виклик harvest_user_hash (щоб зафіксувати старий дохід ДО зміни amount) -> +1 до
--   обладнання. Блокування profiles на початку серіалізує це і з harvest_user_hash,
--   і з exchange_hash_to_ton для того самого користувача.
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
    v_balance           numeric(18, 6);
    v_harvested         numeric(18, 6) := 0;
    v_new_amount        integer;
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    -- персональний м'ютекс
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

    -- блокуємо конкретний рядок обладнання (якщо вже існує), щоб виключити
    -- подвійну купівлю понад ліміт при паралельних викликах
    select amount into v_current_amount
        from public.user_gpus
        where user_id = p_user_id
          and gpu_level = p_level
        for update;

    if not found then
        v_current_amount := 0;
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

    -- списання коштів
    update public.profiles
        set game_balance = game_balance - v_template.cost_ton
        where id = p_user_id
        returning game_balance into v_balance;

    -- фіксуємо дохід зі старої кількості карток ДО того, як amount зміниться
    v_harvested := public.harvest_user_hash(p_user_id);

    -- додаємо одиницю обладнання
    insert into public.user_gpus (user_id, gpu_level, amount, last_harvest_at)
    values (p_user_id, p_level, 1, clock_timestamp())
    on conflict (user_id, gpu_level)
        do update set amount = public.user_gpus.amount + 1
    returning amount into v_new_amount;

    return query select v_balance, v_new_amount, v_harvested;
end;
$$;

revoke all on function public.buy_gpu(uuid, integer) from public;
grant execute on function public.buy_gpu(uuid, integer) to authenticated, service_role;

-- ------------------------------------------------------------------------------------
-- exchange_hash_to_ton(p_user_id, p_hash_amount, p_target_balance)
--   Конвертує $HASH у withdrawable_balance або game_balance за фіксованим курсом.
--   p_target_balance приймає лише 'withdrawable_balance' або 'game_balance'.
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
    -- TODO: у продакшені винести курс і комісію в окрему конфігураційну таблицю,
    -- щоб їх можна було міняти без нової міграції.
    v_rate          constant numeric(18, 6) := 0.00005;  -- 1 $HASH = 0.00005 TON
    v_fee_bps       constant numeric(9, 6)  := 200;      -- 2.00% комісія лише при виводі
    v_hash_balance  numeric(18, 6);
    v_ton_gross     numeric(18, 6);
    v_fee           numeric(18, 6) := 0;
    v_ton_net       numeric(18, 6);
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_hash_amount is null or p_hash_amount <= 0 then
        raise exception 'p_hash_amount must be positive';
    end if;

    if p_target_balance not in ('withdrawable_balance', 'game_balance') then
        raise exception 'invalid p_target_balance: %', p_target_balance;
    end if;

    -- персональний м'ютекс
    select hash_balance into v_hash_balance
        from public.profiles
        where id = p_user_id
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

revoke all on function public.exchange_hash_to_ton(uuid, numeric, text) from public;
grant execute on function public.exchange_hash_to_ton(uuid, numeric, text) to authenticated, service_role;
