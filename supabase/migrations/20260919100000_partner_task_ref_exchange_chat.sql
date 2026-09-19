-- Партнерське завдання: вступити в чат @SharesYour_LiNKS («Ref exchange 👥
-- Обмен рефералами», супергрупа).
--
-- action_type = 'telegram_channel' — з РЕАЛЬНОЮ перевіркою через Bot API
-- getChatMember, а не за самим переходом: наш бот є адміністратором цього
-- чату (перевірено перед додаванням — для гравця поза чатом повертає "left").
-- Тому на завдання діє і штраф за вихід із чату протягом 24 годин, як на
-- решту завдань цього типу.
--
-- Нагорода 0.001 — як у попередніх партнерських завдань-підписок
-- (minerias_channel, crypto_hunters_channel).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    ('partners', 'shares_your_links_chat', '👥', 0.001, 'game_balance', 'telegram_channel',
     '@SharesYour_LiNKS', 120, true)
on conflict (title_key) do update
    set category      = excluded.category,
        icon          = excluded.icon,
        reward_amount = excluded.reward_amount,
        reward_type   = excluded.reward_type,
        action_type   = excluded.action_type,
        target_value  = excluded.target_value,
        sort_order    = excluded.sort_order,
        is_active     = excluded.is_active;
