-- П'ятий партнер: TheiTerra — реальний check API (на відміну від
-- Cookie Wars/Crybble формат відповіді ІНШИЙ: {"data":{"registeredAt":...}}
-- замість {"success":true}, плюс потрібен x-api-key заголовок). Секрет
-- заголовка НЕ в target_value (той повністю йде клієнту через /api/tasks) —
-- лише ім'я env-змінної (THEITERRA_API_KEY), значення читається на сервері
-- в lib/partners/checkExternalTask.ts.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'theiterra_enter',
        '🌍',
        0.003,
        'game_balance',
        'partner_api_check',
        '{"open_url":"https://t.me/TheiTerra_bot/app?startapp=A13FFC4A31","check_url":"https://services.theiterra.pro/api/v1/partners/user?chatId=","header_name":"x-api-key","header_env_key":"THEITERRA_API_KEY","success_path":"data.registeredAt"}',
        50
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
