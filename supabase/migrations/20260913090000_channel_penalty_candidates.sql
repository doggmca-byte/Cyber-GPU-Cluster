-- =====================================================================================
-- Перевірка відписок від каналу — з гарячого шляху входу в гру у власний крон.
--
-- Досі штраф за відписку шукався ВСЕРЕДИНІ /api/user/sync: на кожне відкриття
-- застосунку робився запит до user_tasks, а для тих, хто нещодавно клеймив
-- нагороду за підписку, ще й звернення до Telegram API. Так було не від
-- хорошого життя: на Vercel Hobby дозволено лише два крони на добу, і обидва
-- слоти вже займали депозити та сповіщення про зупинку майнінгу.
--
-- На Pro-плані крони ходять щохвилини, тож перевірка переїжджає туди, а вхід
-- у гру більше не платить за неї ні запитом у БД, ні round-trip до Telegram.
-- Побічно це ще й точніше: раніше того, хто відписався і не заходив у гру,
-- не перевіряв ніхто.
-- =====================================================================================

create or replace function public.list_channel_penalty_candidates(p_limit integer default 500)
returns table (
    user_id      uuid,
    telegram_id  bigint,
    task_id      uuid,
    chat_id      text
)
language sql
security definer
set search_path = public, pg_temp
as $$
    -- Вікно 24 години — рівно те саме, що всередині
    -- apply_channel_unsubscribe_penalty: поза ним штраф уже не діє, тож і
    -- смикати Telegram щодо цих рядків немає сенсу.
    select ut.user_id, p.telegram_id, ut.task_id, tt.target_value
        from public.user_tasks ut
        join public.task_templates tt on tt.id = ut.task_id
        join public.profiles p on p.id = ut.user_id
        where ut.status = 'claimed'
          and ut.channel_penalty_applied = false
          and tt.action_type = 'telegram_channel'
          and ut.claimed_at >= now() - interval '24 hours'
        order by ut.claimed_at
        limit greatest(p_limit, 1);
$$;

revoke all on function public.list_channel_penalty_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_channel_penalty_candidates(integer) to service_role;
