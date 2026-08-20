-- =====================================================================================
-- Telegram-сповіщення "виробництво призупинено" (12г без харвесту, той самий кап,
-- що й у harvest_user_hash / MAX_UNCLAIMED_SECONDS). Vercel Cron на Hobby-плані
-- обмежений 1 запуском/добу — тож не "рівно через 12г", а "раз на добу перевір
-- усіх, чиє виробництво зараз призупинене і кому ще не надсилали за ЦЕЙ епізод".
--
-- Дизайн навмисно РОЗДІЛЯЄ читання (list_paused_production_users) і позначення
-- "надіслано" (mark_production_paused_notified) на дві окремі функції замість
-- одного atomic UPDATE...RETURNING: роут викликає позначення лише ПІСЛЯ реально
-- успішної відповіді від Telegram Bot API. Якщо sendMessage впаде (мережа,
-- користувач заблокував бота) — користувач лишається "не сповіщеним" і
-- автоматично потрапить у список завтра знову, замість тихо "згубитись"
-- назавжди через позначку, виставлену ДО фактичної відправки.
-- =====================================================================================

alter table public.profiles
    add column if not exists telegram_language_code text,
    add column if not exists production_paused_notified_at timestamptz;

-- ------------------------------------------------------------------------------------
-- "Призупинено" визначаємо по MAX(last_harvest_at) серед ЖИВИХ карток
-- (amount > 0, is_dead = false) — це момент останньої реальної взаємодії
-- (harvest чи buy, обидва скидають last_harvest_at); якщо він старіший за
-- p_max_unclaimed_hours — усі картки користувача вже впираються в 12г-кап.
-- Гравці без жодної живої картки (нема що майнити) з вибірки виключаються самим
-- INNER JOIN на paused.
-- ------------------------------------------------------------------------------------
create or replace function public.list_paused_production_users(p_max_unclaimed_hours integer default 12)
returns table (
    profile_id              uuid,
    telegram_id             bigint,
    telegram_language_code  text,
    hash_balance            numeric(18, 6)
)
language sql
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
        -- нема ще позначки за ЦЕЙ епізод паузи АБО позначка старіша за момент,
        -- коли виробництво цього разу зупинилось (тобто відтоді користувач уже
        -- харвестив і "напаузився" знову) — інакше довелось би сповіщати щодня,
        -- поки хтось просто не заходить у застосунок тижнями.
        where pr.production_paused_notified_at is null
           or pr.production_paused_notified_at < p.last_activity;
$$;

create or replace function public.mark_production_paused_notified(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.profiles set production_paused_notified_at = now() where id = p_user_id;
$$;

revoke all on function public.list_paused_production_users(integer) from public, anon, authenticated;
revoke all on function public.mark_production_paused_notified(uuid) from public, anon, authenticated;

grant execute on function public.list_paused_production_users(integer) to service_role;
grant execute on function public.mark_production_paused_notified(uuid) to service_role;
