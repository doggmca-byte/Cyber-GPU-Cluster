-- =====================================================================================
-- Досяжність бота: розділяємо "заблокував" і "ніколи не відкривав чат",
-- і додаємо шлях назад у розсилки.
--
-- Що показала перевірка getChat по 150 активних профілях, позначених
-- is_bot_blocked:
--     108 (72%) — "chat not found": людина взагалі НЕ має приватного чату з
--                 ботом. Для Mini App це нормальний стан: застосунок часто
--                 відкривають із посилання, ніколи не натискаючи Start.
--      42 (28%) — чат існує, тобто позначка щонайменше сумнівна.
--
-- Тобто 45% активних за тиждень (366 з 814) були виключені з усіх сповіщень,
-- і більшість із них — не через блокування, а через стан, який ЛЕГКО
-- виправляється: досить, щоб користувач дав дозвіл на повідомлення.
--
--   1) bot_block_reason — чому саме недосяжний ('blocked' | 'no_chat').
--      is_bot_blocked лишається як було ("надсилати немає сенсу"), щоб не
--      ламати наявні запити, а причина дає змогу вибирати ліки: заблокованого
--      не повернути, а "no_chat" — повертається дозволом у застосунку.
--
--   2) clear_bot_block() — знімає позначку, коли з'явився доказ досяжності:
--      підписаний initData з allows_write_to_pm = true (/api/user/sync) або
--      вхідний апдейт у вебхуці.
-- =====================================================================================

alter table public.profiles
    add column if not exists bot_block_reason text
        check (bot_block_reason is null or bot_block_reason in ('blocked', 'no_chat'));

-- ------------------------------------------------------------------------------------
-- flag_bot_unreachable — позначити з причиною (використовують крон і розсилки).
-- ------------------------------------------------------------------------------------
create or replace function public.flag_bot_unreachable(p_user_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.profiles
        set is_bot_blocked = true,
            bot_block_reason = case when p_reason in ('blocked', 'no_chat') then p_reason else null end
        where id = p_user_id;
$$;

revoke all on function public.flag_bot_unreachable(uuid, text) from public, anon, authenticated;
grant execute on function public.flag_bot_unreachable(uuid, text) to service_role;

-- ------------------------------------------------------------------------------------
-- clear_bot_block — є доказ, що боту можна писати: повертаємо в розсилки.
-- ------------------------------------------------------------------------------------
create or replace function public.clear_bot_block(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.profiles
        set is_bot_blocked = false,
            bot_block_reason = null
        where id = p_user_id
          and (is_bot_blocked or bot_block_reason is not null);
$$;

revoke all on function public.clear_bot_block(uuid) from public, anon, authenticated;
grant execute on function public.clear_bot_block(uuid) to service_role;

-- ------------------------------------------------------------------------------------
-- admin_bot_reach — розклад досяжності для адмінки (вкладка "Сесії").
-- Рахуємо разом із активністю, щоб було видно найважливіше число: скільки
-- ЖИВИХ гравців зараз не можна сповістити.
-- ------------------------------------------------------------------------------------
create or replace function public.admin_bot_reach()
returns table (
    reachable            integer,
    blocked              integer,
    no_chat              integer,
    unknown_reason       integer,
    active7d             integer,
    active7d_reachable   integer,
    active7d_unreachable integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with active as (
        select distinct user_id from (
            select user_id, created_at from public.transactions
            union all
            select user_id, created_at from public.ad_verification_attempts
            union all
            select user_id, updated_at from public.user_tasks
        ) e
        where e.created_at >= now() - interval '7 days'
    )
    select
        count(*) filter (where not p.is_bot_blocked)::integer,
        count(*) filter (where p.is_bot_blocked and p.bot_block_reason = 'blocked')::integer,
        count(*) filter (where p.is_bot_blocked and p.bot_block_reason = 'no_chat')::integer,
        count(*) filter (where p.is_bot_blocked and p.bot_block_reason is null)::integer,
        count(*) filter (where a.user_id is not null)::integer,
        count(*) filter (where a.user_id is not null and not p.is_bot_blocked)::integer,
        count(*) filter (where a.user_id is not null and p.is_bot_blocked)::integer
    from public.profiles p
    left join active a on a.user_id = p.id;
$$;

revoke all on function public.admin_bot_reach() from public, anon, authenticated;
grant execute on function public.admin_bot_reach() to service_role;
