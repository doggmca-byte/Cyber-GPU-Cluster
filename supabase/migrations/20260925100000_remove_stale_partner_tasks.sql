-- Прибираємо чотири партнерські завдання, що більше не актуальні:
-- Cookie Wars, Crybble, Cookie Hunters, MRG Miner.
--
-- Вимкнення, а не видалення рядків — та сама причина, що й для
-- dogs_house_miner_start / memefarm_open: на шаблони могли посилатись
-- user_tasks тих, хто вже виконав завдання, і нараховані транзакції.
-- is_active = false ховає картки від гравців, не ламаючи історію.
update public.task_templates
    set is_active = false
    where title_key in (
        'cookie_wars_game_enter',
        'crybble_game_enter',
        'cookie_hunters_signup',
        'mrg_miner_start'
    );
