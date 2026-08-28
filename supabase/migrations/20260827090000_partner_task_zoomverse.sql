-- Восьмий партнер: ZoomVerse — той самий принцип, що й Cookie Hunters/
-- COIN KERO: партнер дав лише посилання, без check API -> external_link
-- (довіра на слово, той самий компроміс, що й у решти external_link-завдань).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'zoomverse_join',
        '🔍',
        0.003,
        'game_balance',
        'external_link',
        'https://t.me/ZoomVerse_bot?startapp=6288342755',
        80
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
