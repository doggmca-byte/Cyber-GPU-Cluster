-- Партнерські завдання Runes Mining (RMT, @RunesMiningBot): наш юзер -> їхній застосунок.
--
-- action_type = 'partner_api_check', пул-перевірка: GET
--   https://runesmining.online/api/partner/v1/verify?task=<умова>&telegram_id=<id>
-- Відповідь: {"ok":true,"task":...,"completed":true|false,"user":{...},"tasks":{...}}.
-- Невідомий telegram_id -> {"ok":false,"reason":"no_user"} (без поля completed) —
-- success_path "completed" дає undefined -> не виконано. completed — булеве, тож
-- checkExternalTask.ts вимагає строго true.
--
-- Авторизація: заголовок x-partner-key. Сам ключ НЕ тут (target_value повністю йде
-- клієнту через /api/tasks) — лише ім'я env-змінної RMT_PARTNER_KEY, значення
-- читається на сервері. HMAC-секрет партнера потрібен лише для POST /complete,
-- який ми не викликаємо, тому ніде не зберігається.
--
-- Умови партнера: registered (акаунт є), first_claim (перший збір у шахті),
-- connect_wallet (підключено TON-гаманець). Нагорода 0.003 — стандарт партнерських
-- завдань; їхній еквівалент 25 / 50 / 75 RMT. Нагороду своїм гравцям платить
-- кожна сторона сама.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners', 'rmt_open', '⛏️', 0.003, 'game_balance', 'partner_api_check',
        '{"open_url":"https://t.me/RunesMiningBot","check_url":"https://runesmining.online/api/partner/v1/verify?task=registered&telegram_id=","header_name":"x-partner-key","header_env_key":"RMT_PARTNER_KEY","success_path":"completed"}',
        51
    ),
    (
        'partners', 'rmt_first_claim', '💎', 0.003, 'game_balance', 'partner_api_check',
        '{"open_url":"https://t.me/RunesMiningBot","check_url":"https://runesmining.online/api/partner/v1/verify?task=first_claim&telegram_id=","header_name":"x-partner-key","header_env_key":"RMT_PARTNER_KEY","success_path":"completed"}',
        52
    ),
    (
        'partners', 'rmt_connect_wallet', '👛', 0.003, 'game_balance', 'partner_api_check',
        '{"open_url":"https://t.me/RunesMiningBot","check_url":"https://runesmining.online/api/partner/v1/verify?task=connect_wallet&telegram_id=","header_name":"x-partner-key","header_env_key":"RMT_PARTNER_KEY","success_path":"completed"}',
        53
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
