-- Шостий партнер: StarNex — реальний check API (у форматі win-check,
-- userId — сегмент шляху, не суфікс, тому check_url містить плейсхолдер
-- "{telegram_id}", підтримка якого додана в lib/partners/checkExternalTask.ts
-- разом з цією міграцією). Відповідь {"hasWin": true|false} — буквальне
-- булеве значення (не timestamp/presence, як у TheiTerra), тож теж
-- знадобився фікс checkExternalTask.ts на строгу перевірку true.
-- Авторизація — Authorization: Bearer <token> (не x-api-key, як у
-- TheiTerra) — той самий header_name/header_env_key механізм, просто інша
-- назва заголовка; сам токен лише в env (STARNEX_API_TOKEN), НЕ тут.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'starnex_win_combinations',
        '🎰',
        0.003,
        'game_balance',
        'partner_api_check',
        '{"open_url":"https://t.me/lot_tery_bot?start=978994138","check_url":"https://api.tgstars.uk/api/v1/users/{telegram_id}/win-check?count=2","header_name":"Authorization","header_env_key":"STARNEX_API_TOKEN","success_path":"hasWin"}',
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
