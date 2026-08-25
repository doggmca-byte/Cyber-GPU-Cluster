-- Шостий партнер: MINERIAS Y BOT — підписка на Telegram-канал з реальною
-- перевіркою (той самий action_type='telegram_channel', що й наші власні
-- subscribe_channel/subscribe_chat, Bot API getChatMember). ВАЖЛИВО: бот
-- має бути учасником/адміном @MGTYXZ, інакше getChatMember завжди
-- повертатиме ok:false і завдання ніхто не зможе виконати.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'minerias_channel',
        '⛏️',
        0.001,
        'game_balance',
        'telegram_channel',
        '@MGTYXZ',
        60
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
