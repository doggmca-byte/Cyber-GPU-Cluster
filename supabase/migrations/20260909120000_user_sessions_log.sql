-- =====================================================================================
-- Лог сесій: справжній DAU замість непрямих оцінок.
--
-- Досі "активність" доводилось збирати з побічних слідів — транзакцій, спроб
-- перегляду реклами, оновлень завдань. Це давало НИЖНЮ межу: гравець, який
-- зайшов і лише зібрав HASH або купив GPU, у ті числа взагалі не потрапляв
-- (харвест і buy_gpu не пишуть окремих записів, лише оновлюють баланси).
--
--   1) user_sessions — по одному рядку на ВІДКРИТТЯ застосунку. Щоб не
--      писати рядок на кожен виклик /api/user/sync, застосовано стандартне
--      вікно сесії: новий рядок з'являється, лише якщо попередня сесія цього
--      користувача була давніше ніж SESSION_WINDOW (30 хв). Перезавантаження
--      сторінки чи повернення у вкладку в межах вікна лишаються ОДНІЄЮ сесією.
--
--   2) profiles.last_seen_at — оновлюється при кожному синку, незалежно від
--      вікна. Дає "хто зараз онлайн" і "коли востаннє заходив".
--
--   3) record_session() навмисно НІКОЛИ не кидає помилку назовні — сесія це
--      телеметрія, вона не має права зламати вхід у застосунок.
-- =====================================================================================

create table if not exists public.user_sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles (id) on delete cascade,
    started_at  timestamptz not null default now()
);

-- Головний запит адмінки — "скільки унікальних за день" — іде по started_at.
create index if not exists idx_user_sessions_started_at
    on public.user_sessions (started_at desc);

-- Пошук останньої сесії конкретного юзера (вікно 30 хв у record_session).
create index if not exists idx_user_sessions_user_started
    on public.user_sessions (user_id, started_at desc);

alter table public.user_sessions enable row level security;
-- Політик навмисно немає: доступ лише через бекенд із service_role.

alter table public.profiles
    add column if not exists last_seen_at timestamptz;

create index if not exists idx_profiles_last_seen_at
    on public.profiles (last_seen_at desc);

-- ------------------------------------------------------------------------------------
-- record_session — викликається з /api/user/sync на кожен вхід.
-- ------------------------------------------------------------------------------------
create or replace function public.record_session(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_session_window constant interval := interval '30 minutes';
    v_last_started   timestamptz;
begin
    if p_user_id is null then
        return;
    end if;

    update public.profiles
        set last_seen_at = now()
        where id = p_user_id;

    if not found then
        return;
    end if;

    select s.started_at into v_last_started
        from public.user_sessions s
        where s.user_id = p_user_id
        order by s.started_at desc
        limit 1;

    -- Нова сесія лише якщо попередня була давніше вікна (або її не було).
    if v_last_started is null or v_last_started < now() - v_session_window then
        insert into public.user_sessions (user_id) values (p_user_id);
    end if;
end;
$$;

revoke all on function public.record_session(uuid) from public, anon, authenticated;
grant execute on function public.record_session(uuid) to service_role;

-- ------------------------------------------------------------------------------------
-- admin_session_stats — денна розбивка для адмінки.
-- Агрегація повністю в БД: жодних списків id через HTTP і жодного ліміту в
-- 1000 рядків PostgREST (та сама причина, що й у admin_ambassador_stats).
-- ------------------------------------------------------------------------------------
create or replace function public.admin_session_stats(p_days integer default 30)
returns table (
    day               date,
    sessions          integer,
    active_users      integer,
    returning_users   integer,
    new_users         integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with days as (
        select generate_series(
            (now() at time zone 'utc')::date - (greatest(p_days, 1) - 1),
            (now() at time zone 'utc')::date,
            interval '1 day'
        )::date as day
    ),
    sess as (
        select (s.started_at at time zone 'utc')::date as day,
               count(*)::integer as sessions,
               count(distinct s.user_id)::integer as active_users,
               count(distinct s.user_id) filter (
                   where (p.created_at at time zone 'utc')::date < (s.started_at at time zone 'utc')::date
               )::integer as returning_users
        from public.user_sessions s
        join public.profiles p on p.id = s.user_id
        group by 1
    ),
    reg as (
        select (created_at at time zone 'utc')::date as day, count(*)::integer as new_users
        from public.profiles
        group by 1
    )
    select d.day,
           coalesce(sess.sessions, 0),
           coalesce(sess.active_users, 0),
           coalesce(sess.returning_users, 0),
           coalesce(reg.new_users, 0)
    from days d
    left join sess on sess.day = d.day
    left join reg  on reg.day  = d.day
    order by d.day desc;
$$;

revoke all on function public.admin_session_stats(integer) from public, anon, authenticated;
grant execute on function public.admin_session_stats(integer) to service_role;

-- ------------------------------------------------------------------------------------
-- admin_session_totals — зведені показники нагорі вкладки.
-- ------------------------------------------------------------------------------------
create or replace function public.admin_session_totals()
returns table (
    online_now      integer,
    dau             integer,
    wau             integer,
    mau             integer,
    sessions_today  integer,
    registered      integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        (select count(*)::integer from public.profiles
            where last_seen_at >= now() - interval '5 minutes')                        as online_now,
        (select count(distinct user_id)::integer from public.user_sessions
            where started_at >= (now() at time zone 'utc')::date)                      as dau,
        (select count(distinct user_id)::integer from public.user_sessions
            where started_at >= now() - interval '7 days')                             as wau,
        (select count(distinct user_id)::integer from public.user_sessions
            where started_at >= now() - interval '30 days')                            as mau,
        (select count(*)::integer from public.user_sessions
            where started_at >= (now() at time zone 'utc')::date)                      as sessions_today,
        (select count(*)::integer from public.profiles)                                as registered;
$$;

revoke all on function public.admin_session_totals() from public, anon, authenticated;
grant execute on function public.admin_session_totals() to service_role;
