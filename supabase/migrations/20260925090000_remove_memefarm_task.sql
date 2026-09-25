-- Прибираємо партнерське завдання Meme Farm із переліку завдань.
--
-- Саме вимкнення, а не видалення рядка: та сама причина, що й для
-- dogs_house_miner_start — на шаблон могли посилатись user_tasks тих,
-- хто вже виконав, і нараховані транзакції. is_active = false ховає
-- завдання від гравців, не ламаючи історію.
update public.task_templates
    set is_active = false
    where title_key = 'memefarm_open';
