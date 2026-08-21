-- Другий реальний партнер: Crybble ("вхід на арену за 1 CBW, подарунково") —
-- той самий partner_api_check, що й cookie_wars_game_enter.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'crybble_game_enter',
        'handshake',
        0.003,
        'game_balance',
        'partner_api_check',
        '{"open_url":"https://t.me/crybblegame_bot/crybble?startapp=6288342755","check_url":"https://api.crybblewars.org/partners/task?id=6d349fa256924617a123c80bc22296ce&telegram_id="}',
        20
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
