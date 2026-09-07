-- =====================================================================================
-- Акційна знижка на обрані GPU + прапорець "бот заблокований користувачем".
--
--   1) promo_campaigns — конфіг акції ЖИВЕ В БД, а не в TS-константі. Причина:
--      єдиним джерелом правди за часом мусить бути сервер (now()), інакше
--      клієнт міг би підкрутити системний час і купити зі знижкою після
--      дедлайну. buy_gpu читає цю ж таблицю тим самим now(), а клієнт лише
--      ВІДОБРАЖАЄ те, що йому віддав /api/user/sync (ends_at + server_time).
--
--   2) Знижка застосовується виключно всередині buy_gpu: клієнт НЕ передає
--      ціну — він взагалі не має способу вплинути на списання. Після
--      ends_at та сама покупка автоматично коштує повну ціну, без жодного
--      ручного втручання чи деплою.
--
--   3) profiles.is_bot_blocked — для розсилок: Telegram віддає 403, коли
--      користувач зупинив бота; такі профілі позначаємо, щоб наступні
--      розсилки їх не чіпали (у нас уже був випадок, коли 83% адресатів
--      давали "chat not found" і з'їдали весь ліміт розсилки).
-- =====================================================================================

create table if not exists public.promo_campaigns (
    id                uuid primary key default gen_random_uuid(),
    slug              text not null unique,
    discount_percent  integer not null check (discount_percent between 1 and 90),
    -- Рівні GPU, на які діє знижка (gpu_templates.level).
    target_levels     integer[] not null check (array_length(target_levels, 1) > 0),
    starts_at         timestamptz not null,
    ends_at           timestamptz not null,
    is_active         boolean not null default true,
    created_at        timestamptz not null default now(),

    constraint promo_campaigns_window_valid check (ends_at > starts_at)
);

-- Часткові індекси під єдиний реальний запит: "чи є зараз активна акція".
create index if not exists idx_promo_campaigns_window
    on public.promo_campaigns (starts_at, ends_at)
    where is_active;

alter table public.promo_campaigns enable row level security;

-- Читання лише через бекенд (service_role обходить RLS) — політик навмисно
-- немає, як і в решті таблиць проєкту.

alter table public.profiles
    add column if not exists is_bot_blocked boolean not null default false;

create index if not exists idx_profiles_is_bot_blocked
    on public.profiles (is_bot_blocked)
    where is_bot_blocked;

-- ------------------------------------------------------------------------------------
-- active_promo() — єдина точка, що вирішує "акція діє прямо зараз".
-- Використовують і buy_gpu (для списання), і бекенд-роут (для UI).
-- ------------------------------------------------------------------------------------
create or replace function public.active_promo()
returns table (
    slug              text,
    discount_percent  integer,
    target_levels     integer[],
    starts_at         timestamptz,
    ends_at           timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pc.slug, pc.discount_percent, pc.target_levels, pc.starts_at, pc.ends_at
    from public.promo_campaigns pc
    where pc.is_active
      and now() >= pc.starts_at
      and now() <  pc.ends_at
    order by pc.starts_at desc
    limit 1;
$$;

revoke all on function public.active_promo() from public, anon, authenticated;
grant execute on function public.active_promo() to service_role;

-- ------------------------------------------------------------------------------------
-- buy_gpu: та сама логіка, плюс акційна ціна.
-- Ціна рахується ТУТ і ніде більше: v_price = round(cost_ton * (100 - discount) / 100, 6).
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
    v_discount          integer;
    v_price             numeric(18, 6);
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

    -- Акційна ціна: лише якщо акція діє ЗА ЧАСОМ СЕРВЕРА і цей рівень у списку.
    -- Клієнт не передає ціну взагалі, тож підмінити її неможливо; після
    -- ends_at ця ж покупка автоматично коштує повну ціну.
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
-- Сама акція: -10% на GTX Dual Farm (2), RTX 4090 AI Node (3),
-- Tensor Core V100 (5), Quantum Cryo-Qubit (9) — рівно 48 годин від моменту
-- застосування міграції.
-- ------------------------------------------------------------------------------------
insert into public.promo_campaigns (slug, discount_percent, target_levels, starts_at, ends_at)
values ('launch_5k_minus10', 10, array[2, 3, 5, 9], now(), now() + interval '48 hours')
on conflict (slug) do nothing;
