-- Партнерське завдання MRG Miner — БЕЗ перевірки через API партнера.
--
-- action_type = 'external_link': у партнера немає ендпойнта для підтвердження
-- реєстрації, тож завдання зараховується за фактом переходу — так само, як
-- Dogs House Miner і Cookie Hunters у цій же категорії.
--
-- Нагорода 0.003 — стандарт для партнерських завдань, sort_order 110 ставить
-- картку в кінець списку партнерів.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    ('partners', 'mrg_miner_start', '⛏️', 0.003, 'game_balance', 'external_link',
     'https://t.me/mrgminerbot/app?startapp=ref_RS3G0MY7', 110, true)
on conflict (title_key) do update
    set category      = excluded.category,
        icon          = excluded.icon,
        reward_amount = excluded.reward_amount,
        reward_type   = excluded.reward_type,
        action_type   = excluded.action_type,
        target_value  = excluded.target_value,
        sort_order    = excluded.sort_order,
        is_active     = excluded.is_active;
