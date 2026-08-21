-- Четвертий партнер: COIN KERO | BOT — так само, як Cookie Hunters, лише
-- посилання на бота (t.me/COINKEROBOT?start=WT53NH) й опис, без check API ->
-- external_link (довіра на слово, той самий компроміс, що й у решти
-- external_link-завдань).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'coin_kero_start',
        '💠',
        0.003,
        'game_balance',
        'external_link',
        'https://t.me/COINKEROBOT?start=WT53NH',
        40
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
