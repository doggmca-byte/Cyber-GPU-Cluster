-- Партнерські завдання Runes Mining (rmt_open / rmt_first_claim / rmt_connect_wallet,
-- 20261110100000_partner_task_rmt.sql) прибрані з додатку за рішенням власника.
--
-- Вимикаємо (is_active = false), а НЕ видаляємо рядки: user_tasks і
-- partner_task_clicks посилаються на task_templates з ON DELETE CASCADE, тож DELETE
-- безповоротно стер би записи "отримано" в усіх, хто вже забрав нагороду (на момент
-- вимкнення: 24 / 18 / 14 людей). Нагороди вже виплачені й лежать у transactions —
-- історія й лічильники завдань у гравців лишаються цілими. /api/tasks та
-- /api/tasks/verify віддають лише is_active = true, тож у додатку завдань більше нема.
-- Повернути: update public.task_templates set is_active = true where title_key like 'rmt_%';
update public.task_templates
    set is_active = false
    where title_key in ('rmt_open', 'rmt_first_claim', 'rmt_connect_wallet');
