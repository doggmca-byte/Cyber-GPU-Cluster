-- Третій партнер: Cookie Hunters — БЕЗ check API (партнер дав лише
-- реф-посилання й опис, не URL для перевірки) -> звичайний external_link,
-- той самий тип, що вже є в "general"/visit_website (довіра на слово:
-- "Виконати" відкриває посилання, "Перевірити" одразу зараховує completed,
-- реальної перевірки виконання технічно нема — той самий компроміс, що й
-- у наявних external_link-завданнях).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'cookie_hunters_signup',
        'handshake',
        0.003,
        'game_balance',
        'external_link',
        'https://t.me/TokenHuntersbot?startapp=ref_816f5dca',
        30
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
