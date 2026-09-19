-- Партнерське завдання AXVR Stars Miner (@AxyvaraBot) — просто перехід.
--
-- action_type = 'external_link': API для перевірки реєстрації у партнера
-- немає, тож завдання зараховується за фактом переходу — так само, як
-- MRG Miner і Cookie Hunters у цій же категорії.
--
-- Нагорода 0.003 — як в інших партнерських завданнях-переходах, sort_order 130
-- ставить картку в кінець списку партнерів.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    ('partners', 'axvr_stars_miner_start', '⭐', 0.003, 'game_balance', 'external_link',
     'https://t.me/AxyvaraBot?start=ref_8712675493', 130, true)
on conflict (title_key) do update
    set category      = excluded.category,
        icon          = excluded.icon,
        reward_amount = excluded.reward_amount,
        reward_type   = excluded.reward_type,
        action_type   = excluded.action_type,
        target_value  = excluded.target_value,
        sort_order    = excluded.sort_order,
        is_active     = excluded.is_active;
