-- Партнерське завдання Dogs House Miner — БЕЗ перевірки через API партнера.
--
-- action_type = 'external_link' (а не 'partner_api_check'): у партнера немає
-- ендпойнта, яким можна підтвердити реєстрацію, тож завдання зараховується
-- за фактом переходу — так само, як Cookie Hunters нижче в цій же категорії.
--
-- Нагорода 0.003 — стандарт для партнерських завдань, sort_order 100 ставить
-- картку в кінець списку партнерів.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    ('partners', 'dogs_house_miner_start', '🐶', 0.003, 'game_balance', 'external_link',
     'https://t.me/DogsHouseMiner_bot?start=ref_6288342755', 100, true)
on conflict (title_key) do update
    set category      = excluded.category,
        icon          = excluded.icon,
        reward_amount = excluded.reward_amount,
        reward_type   = excluded.reward_type,
        action_type   = excluded.action_type,
        target_value  = excluded.target_value,
        sort_order    = excluded.sort_order,
        is_active     = excluded.is_active;
