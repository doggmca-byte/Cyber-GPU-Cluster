-- =====================================================================================
-- Завдання "Підпишись на канал виплат" (@CGPU_transactions) — поруч із
-- subscribe_channel і subscribe_chat, та сама механіка telegram_channel.
--
-- Спершу рядок створювався з is_active = false: перевірка підписки йде через
-- Bot API getChatMember, а він вимагає, щоб @CyberGPU_bot був адміністратором
-- каналу, і тоді канал ще відповідав "member list is inaccessible". Завдання,
-- показане гравцям у такому стані, не зміг би виконати НІХТО.
--
-- Права боту видано, перевірено на живих telegram_id (канал повертає "left"
-- для непідписаних, як і давно робочий @CGPU_CL) — завдання увімкнено
-- окремою міграцією activate_payouts_channel_task.
-- =====================================================================================

insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    -- Нагорода 0.02 — рівно як у сусідніх subscribe_channel / subscribe_chat.
    -- sort_order 17 ставить картку між чатом (15) і рештою категорії.
    ('general', 'subscribe_payouts_channel', 'wallet', 0.02, 'game_balance', 'telegram_channel', '@CGPU_transactions', 17, false)
on conflict (title_key) do update
    set category      = excluded.category,
        icon          = excluded.icon,
        reward_amount = excluded.reward_amount,
        reward_type   = excluded.reward_type,
        action_type   = excluded.action_type,
        target_value  = excluded.target_value,
        sort_order    = excluded.sort_order;
