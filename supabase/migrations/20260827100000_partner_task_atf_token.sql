-- Дев'ятий партнер: ATF Token — той самий принцип, що й ZoomVerse/Cookie
-- Hunters/COIN KERO: партнер дав лише посилання, без check API ->
-- external_link (довіра на слово).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'atf_token_join',
        '🪂',
        0.003,
        'game_balance',
        'external_link',
        'https://t.me/ATF_AIRDROP_bot?start=6288342755',
        90
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
