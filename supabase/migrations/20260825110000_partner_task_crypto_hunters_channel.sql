-- Сьомий партнер: Crypto Hunters — підписка на Telegram-канал, той самий
-- принцип, що й MINERIAS Y BOT (20260825100000). ВАЖЛИВО: бот наразі НЕ
-- учасник @CryptoHChannel (перевірено live через getChatMember —
-- "member list is inaccessible"), доки це не виправлено на боці Telegram —
-- завдання нікому не виконати.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'crypto_hunters_channel',
        '🕵️',
        0.001,
        'game_balance',
        'telegram_channel',
        '@CryptoHChannel',
        70
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
