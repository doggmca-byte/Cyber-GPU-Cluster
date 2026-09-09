-- =====================================================================================
-- Розсилка "виробництво призупинено" перестає гатити в тих, хто заблокував бота.
--
-- Знайдено перевіркою живих даних: у списку кандидатів 725 профілів, і 665 із
-- них (92%) уже позначені is_bot_blocked. Тобто щодня крон робив ~665
-- заздалегідь приречених викликів Telegram API, отримував 403 / "chat not
-- found" і НЕ позначав їх (навмисно — щоб тимчасові збої ретраїлись), через
-- що ті самі 665 поверталися в список і наступного дня. Назавжди.
--
-- Тепер список віддає лише реально досяжних. Прапорець зводиться в обидва
-- боки: крон ставить is_bot_blocked = true, коли Telegram каже, що доставка
-- неможлива, а вебхук знімає його, щойно від користувача приходить будь-який
-- апдейт (щоб написати боту, треба спершу його розблокувати).
-- =====================================================================================

create or replace function public.list_paused_production_users(p_max_unclaimed_hours integer default 12)
returns table (
    profile_id              uuid,
    telegram_id             bigint,
    telegram_language_code  text,
    hash_balance            numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with paused as (
        select ug.user_id, max(ug.last_harvest_at) as last_activity
            from public.user_gpus ug
            where ug.amount > 0
              and ug.is_dead = false
            group by ug.user_id
            having max(ug.last_harvest_at) <= now() - (p_max_unclaimed_hours || ' hours')::interval
    )
    select pr.id, pr.telegram_id, pr.telegram_language_code, pr.hash_balance
        from public.profiles pr
        join paused p on p.user_id = pr.id
        where not pr.is_bot_blocked
          and (pr.production_paused_notified_at is null
               or pr.production_paused_notified_at < p.last_activity);
$$;

revoke all on function public.list_paused_production_users(integer) from public, anon, authenticated;
grant execute on function public.list_paused_production_users(integer) to service_role;

-- ------------------------------------------------------------------------------------
-- set_bot_blocked — крон позначає недосяжних, вебхук знімає позначку.
-- Окрема функція (а не прямий update з роуту), щоб обидва шляхи ходили одним
-- перевіреним місцем і працювали під service_role без RLS-нюансів.
-- ------------------------------------------------------------------------------------
create or replace function public.set_bot_blocked(p_user_id uuid, p_blocked boolean)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.profiles
        set is_bot_blocked = p_blocked
        where id = p_user_id
          and is_bot_blocked is distinct from p_blocked;
$$;

revoke all on function public.set_bot_blocked(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_bot_blocked(uuid, boolean) to service_role;

-- Те саме за telegram_id — вебхук знає лише його, профіль шукати зайвий раз не треба.
create or replace function public.set_bot_blocked_by_telegram_id(p_telegram_id bigint, p_blocked boolean)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.profiles
        set is_bot_blocked = p_blocked
        where telegram_id = p_telegram_id
          and is_bot_blocked is distinct from p_blocked;
$$;

revoke all on function public.set_bot_blocked_by_telegram_id(bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_bot_blocked_by_telegram_id(bigint, boolean) to service_role;
