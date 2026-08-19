-- =====================================================================================
-- 1) subscribe_channel: замінюємо плейсхолдер @your_channel_here на реальний канал.
-- 2) Нове завдання subscribe_chat (категорія 'general', поруч із subscribe_channel) —
--    підписка на груповий чат. action_type лишається 'telegram_channel': сама
--    перевірка (lib/telegram/getChatMember.ts -> isChannelMember) вже узагальнена
--    на "канал/чат" — Bot API getChatMember працює однаково для обох, різниці в
--    коді не потрібно, лише новий рядок даних із chat_id групи.
-- =====================================================================================

update public.task_templates
    set target_value = '@CGPU_CL'
    where title_key = 'subscribe_channel';

insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    ('general', 'subscribe_chat', 'users', 0.02, 'game_balance', 'telegram_channel', '@GPU_ChitChat', 15)
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
