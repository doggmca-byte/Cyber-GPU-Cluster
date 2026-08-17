-- =====================================================================================
-- 1) Seed gpu_templates: 10 рівнів з точним балансом гри.
-- 2) transactions.type: додано 'purchase_gpu'; buy_gpu тепер пише запис у transactions.
-- 3) exchange_hash_to_ton: курс зафіксовано 100 000 HASH = 1 TON (0.00001 TON/HASH),
--    мінімальна сума обміну — 1000 HASH.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) SEED gpu_templates
-- ------------------------------------------------------------------------------------
insert into public.gpu_templates (level, name, rarity, cost_ton, hash_per_second, max_limit)
values
    (1,  'Raspberry Neural Core',     'common',       0.25,   0.004166,  10),
    (2,  'GTX Dual Farm',             'uncommon',     0.75,   0.013333,  10),
    (3,  'RTX 4090 AI Node',          'rare',         2.00,   0.046388,  10),
    (4,  'Apple M-Max Cluster',       'elite',        5.00,   0.127222,  10),
    (5,  'Tensor Core V100',          'epic',         12.00,  0.312500,  10),
    (6,  'NVIDIA A100 Substation',    'legendary',    25.00,  0.694444,  10),
    (7,  'H100 Sovereign Cloud',      'mythic',       45.00,  1.333333,  10),
    (8,  'Blackwell B200 Supernode',  'ancient',      75.00,  2.314722,  10),
    (9,  'Quantum Cryo-Qubit',        'divine',       150.00, 4.861111,  10),
    (10, 'Dyson Swarm ASI Nexus',     'transcendent', 300.00, 9.953611,  10)
on conflict (level) do update
    set name             = excluded.name,
        rarity            = excluded.rarity,
        cost_ton          = excluded.cost_ton,
        hash_per_second   = excluded.hash_per_second,
        max_limit         = excluded.max_limit;

-- ------------------------------------------------------------------------------------
-- 2a) transactions.type: додаємо 'purchase_gpu'
-- ------------------------------------------------------------------------------------
alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in ('deposit', 'withdraw', 'exchange_hash', 'convert_balance', 'purchase_gpu'));

-- ------------------------------------------------------------------------------------
-- 2b) buy_gpu: той самий порядок дій, додано запис у transactions наприкінці
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

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'purchase_gpu',
        -v_template.cost_ton,
        0,
        'completed',
        jsonb_build_object('level', p_level, 'name', v_template.name, 'rarity', v_template.rarity)
    );

    return query select v_balance, v_new_amount, v_harvested;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 2c) exchange_hash_to_ton: курс 100 000 HASH = 1 TON, мінімум 1000 HASH за обмін
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
    -- курс зафіксований продуктово: 100 000 HASH = 1 TON
    v_rate            constant numeric(18, 6) := 0.00001;
    v_min_hash        constant numeric(18, 6) := 1000;
    v_fee_bps         constant numeric(9, 6)  := 200; -- 2.00% комісія лише при виводі
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
