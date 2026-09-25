-- Партнерське завдання Gram Generator (@GramGeneratorBot).
--
-- action_type = 'partner_api_check': партнер надав робочий check-ендпоінт
-- (їхня Edge Function), що приймає chatId і повертає {"success": true/false}.
-- Ключ авторизації (GRAM_GENERATOR_API_KEY) читається сервером з env, у
-- target_value зберігається лише назва змінної, а не сам секрет — так само,
-- як для theiterra_enter. success_path вказано явно, хоч і збігається з
-- дефолтом checkExternalTask.ts.
--
-- Нагорода 0.003 / sort_order 50 — як у theiterra_enter (той самий тип
-- завдання-переходу, партнер не називав власних значень).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values (
    'partners', 'gram_generator_enter', '⚡', 0.003, 'game_balance', 'partner_api_check',
    '{"open_url":"https://t.me/GramGeneratorBot/app?startapp=xpromo","check_url":"https://jmukthqmygblxqvvlwct.supabase.co/functions/v1/partner-check-user?chatId=","header_name":"x-api-key","header_env_key":"GRAM_GENERATOR_API_KEY","success_path":"success"}',
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
