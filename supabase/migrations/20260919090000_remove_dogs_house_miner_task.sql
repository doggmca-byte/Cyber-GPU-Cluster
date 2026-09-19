-- Прибираємо партнерське завдання Dogs House Miner із переліку завдань.
--
-- Саме вимкнення, а не видалення рядка: на шаблон посилаються user_tasks
-- тих, хто його вже виконав, і нараховані за нього транзакції. Видалення
-- зламало б ці зв'язки й стерло історію; is_active = false просто ховає
-- завдання від усіх гравців — так само, як інші завершені партнерства
-- (coin_kero_start, zoomverse_join, atf_token_join).
update public.task_templates
    set is_active = false
    where title_key = 'dogs_house_miner_start';
