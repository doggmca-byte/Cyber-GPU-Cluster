-- Прибираємо партнерське завдання AXVR Stars Miner.
--
-- Вимкнення, а не видалення рядка — та сама причина, що й в
-- 20260925100000_remove_stale_partner_tasks.sql: на шаблон посилаються
-- user_tasks тих, хто вже виконав завдання, і нараховані транзакції.
-- is_active = false ховає картку від гравців, не ламаючи історію.
update public.task_templates
    set is_active = false
    where title_key = 'axvr_stars_miner_start';
