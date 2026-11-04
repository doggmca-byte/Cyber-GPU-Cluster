-- =====================================================================================
-- GPU-партії: власний lifecycle і лічильник оживлень на КОЖНУ партію, а не на
-- весь рівень гравця.
--
-- Проблема: user_gpus мав рівно один рядок на (user, level), а revival_count
-- жив на цьому рядку. Гравець купував 1 картку, чекав її смерті, оживляв за
-- 75% ціни ОДНІЄЇ картки, а потім докуповував 9 штук у той самий рядок — і всі
-- 10 одразу опинялись на дешевших оживленнях (50% / 25%), минаючи 75%. Перший
-- цикл (найменш вигідний, +25%) великі гроші пропускали повністю.
--
-- Тепер рядок user_gpus — це партія:
--   * buy_gpu докидає картку лише у "відкриту" партію рівня (жива і ще жодного
--     разу не оживлена — revival_count = 0). Злиття з такою партією чесне:
--     кап і швидкість ростуть пропорційно amount, а наступне оживлення в неї
--     однаково перше (75%). Якщо відкритої партії нема — створюється нова, і
--     її картки проходять усі цикли з першого.
--   * revive_gpu оживляє конкретну партію (p_gpu_id); без нього — найстаршу
--     мертву партію рівня, яку ще можна оживити (сумісність зі старим клієнтом).
--   * max_limit рахується сумою amount по партіях рівня, крім вичерпаних
--     (мертві після 3 оживлень) — раніше вичерпаний рівень блокував покупку
--     назавжди.
-- Наявні рядки лишаються як є (кожен стає партією зі своєю історією).
-- =====================================================================================

alter table public.user_gpus
    add column if not exists created_at timestamptz not null default now();

alter table public.user_gpus
    drop constraint if exists user_gpus_user_level_uq;

-- Не більше однієї відкритої партії на рівень — саме в неї buy_gpu докидає
-- картки. Мертві й оживлені партії під індекс не потрапляють, тож їх на рівні
-- може бути скільки завгодно.
create unique index if not exists user_gpus_open_lot_uq
    on public.user_gpus (user_id, gpu_level)
    where revival_count = 0 and not is_dead;

-- ------------------------------------------------------------------------------------
-- buy_gpu: той самий алгоритм (промо-ціна, harvest перед зміною amount), але
-- картка йде у відкриту партію або в нову, і мертвий рівень покупку не блокує.
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
    v_owned             integer := 0;
    v_balance           numeric(18, 6);
    v_harvested         numeric(18, 6) := 0;
    v_new_amount        integer;
    v_discount          integer;
    v_price             numeric(18, 6);
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    -- Лок профілю серіалізує всі покупки гравця — перевірка ліміту нижче не
    -- гониться з паралельною покупкою.
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

    -- Вичерпані партії (мертві, оживлень не лишилось) у ліміт не входять.
    select coalesce(sum(ug.amount), 0) into v_owned
        from public.user_gpus ug
        where ug.user_id = p_user_id
          and ug.gpu_level = p_level
          and not (ug.is_dead and ug.revival_count >= 3);

    if v_owned >= v_template.max_limit then
        raise exception 'gpu level % purchase limit reached (% / %)',
            p_level, v_owned, v_template.max_limit
            using errcode = 'P0001';
    end if;

    -- Акційна ціна: лише якщо акція діє ЗА ЧАСОМ СЕРВЕРА і цей рівень у списку.
    select ap.discount_percent into v_discount
        from public.active_promo() ap
        where p_level = any(ap.target_levels);

    v_price := case
        when v_discount is null then v_template.cost_ton
        else round(v_template.cost_ton * (100 - v_discount) / 100.0, 6)
    end;

    if v_balance < v_price then
        raise exception 'insufficient game_balance: has %, needs %',
            v_balance, v_price
            using errcode = 'P0001';
    end if;

    update public.profiles
        set game_balance = game_balance - v_price
        where id = p_user_id
        returning game_balance into v_balance;

    -- Спершу нараховуємо все, що вже накопичено, за СТАРОЮ кількістю карток
    -- (і, можливо, позначаємо відкриту партію мертвою — тоді нижче вона вже
    -- не відкрита, і картка піде в нову партію).
    v_harvested := public.harvest_user_hash(p_user_id);

    update public.user_gpus as ug
        set amount = ug.amount + 1
        where ug.user_id = p_user_id
          and ug.gpu_level = p_level
          and ug.revival_count = 0
          and not ug.is_dead
        returning ug.amount into v_new_amount;

    if not found then
        insert into public.user_gpus (user_id, gpu_level, amount, last_harvest_at)
        values (p_user_id, p_level, 1, clock_timestamp())
        returning amount into v_new_amount;
    end if;

    return query select v_balance, v_new_amount, v_harvested;
end;
$$;

revoke all on function public.buy_gpu(uuid, integer) from public, anon, authenticated;
grant execute on function public.buy_gpu(uuid, integer) to service_role;

-- ------------------------------------------------------------------------------------
-- revive_gpu: оживлення конкретної партії. Сигнатура змінюється (новий
-- p_gpu_id і gpu_id у результаті), тож стару функцію прибираємо.
-- ------------------------------------------------------------------------------------
drop function if exists public.revive_gpu(uuid, integer);

create function public.revive_gpu(p_user_id uuid, p_level integer, p_gpu_id uuid default null)
returns table (
    new_game_balance    numeric(18, 6),
    revival_count        integer,
    revival_cost          numeric(18, 6),
    gpu_id                uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_revival_multipliers constant numeric[] := array[0.75, 0.5, 0.25];
    v_template            public.gpu_templates%rowtype;
    v_gpu                 record;
    v_balance             numeric(18, 6);
    v_cost                numeric(18, 6);
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    select pr.game_balance into v_balance
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select * into v_template from public.gpu_templates gt where gt.level = p_level;
    if not found then
        raise exception 'gpu template level % not found', p_level using errcode = 'P0002';
    end if;

    -- Без p_gpu_id — найстарша мертва партія рівня, яку ще можна оживити.
    select ug.id, ug.amount, ug.is_dead, ug.revival_count into v_gpu
        from public.user_gpus ug
        where ug.user_id = p_user_id
          and ug.gpu_level = p_level
          and (p_gpu_id is null or ug.id = p_gpu_id)
        order by (ug.is_dead and ug.revival_count < 3) desc, ug.created_at, ug.id
        limit 1
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

    update public.profiles as pr
        set game_balance = pr.game_balance - v_cost
        where pr.id = p_user_id
        returning pr.game_balance into v_balance;

    update public.user_gpus as ug
        set is_dead = false,
            lifetime_hash_generated = 0,
            last_harvest_at = clock_timestamp(),
            revival_count = ug.revival_count + 1
        where ug.id = v_gpu.id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id, 'revive_gpu', -v_cost, 0, 'completed',
        jsonb_build_object(
            'gpu_level', p_level,
            'gpu_id', v_gpu.id,
            'revival_count', v_gpu.revival_count + 1
        )
    );

    return query select v_balance, v_gpu.revival_count + 1, v_cost, v_gpu.id;
end;
$$;

revoke all on function public.revive_gpu(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.revive_gpu(uuid, integer, uuid) to service_role;

-- ------------------------------------------------------------------------------------
-- collect_hash: те саме тіло, лише стабільний порядок партій усередині рівня
-- (раніше на рівень був один рядок, тож вистачало order by gpu_level).
-- ------------------------------------------------------------------------------------
create or replace function public.collect_hash(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_collected        numeric(18, 6);
    v_hash_balance     numeric(18, 6);
    v_game_balance     numeric(18, 6);
    v_withdrawable     numeric(18, 6);
    v_last_collected   timestamptz;
    v_user_gpus        jsonb;
begin
    -- Кидає P0002, якщо профілю немає. Локи (профіль + user_gpus) тримаються
    -- до кінця цієї транзакції, тож читання нижче бачить узгоджений стан.
    v_collected := public.harvest_user_hash(p_user_id);

    select pr.hash_balance, pr.game_balance, pr.withdrawable_balance
        into v_hash_balance, v_game_balance, v_withdrawable
        from public.profiles pr
        where pr.id = p_user_id;

    select max(ug.last_harvest_at)
        into v_last_collected
        from public.user_gpus ug
        where ug.user_id = p_user_id
          and ug.amount > 0
          and not ug.is_dead;

    select coalesce(
               jsonb_agg(to_jsonb(ug) order by ug.gpu_level, ug.created_at, ug.id),
               '[]'::jsonb
           )
        into v_user_gpus
        from public.user_gpus ug
        where ug.user_id = p_user_id;

    return jsonb_build_object(
        'success', true,
        'collected', v_collected,
        'new_hash_balance', v_hash_balance,
        'game_balance', v_game_balance,
        'withdrawable_balance', v_withdrawable,
        'last_collected_at', v_last_collected,
        'user_gpus', v_user_gpus,
        'server_time', clock_timestamp()
    );
end;
$$;

revoke all on function public.collect_hash(uuid) from public, anon, authenticated;
grant execute on function public.collect_hash(uuid) to service_role;
