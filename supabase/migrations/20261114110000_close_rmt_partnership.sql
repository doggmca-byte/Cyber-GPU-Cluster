-- Партнерство з Runes Mining (RMT) закрито. Завдання rmt_* вимкнені раніше
-- (20261114100000_deactivate_rmt_tasks.sql); тут вимикаємо й чек-slug, заведений
-- спеціально для їхніх гравців: /api/partners/check?id=cgc-first-claim тепер дає 404.
-- Рядок лишається (is_active = false), щоб можна було повернути одним update.
-- cgc-app-open / cgc-own-gpu-* НЕ чіпаємо: вони з серпня (до RMT) і можуть
-- використовуватись іншими партнерами.
update public.partner_check_definitions
    set is_active = false
    where slug = 'cgc-first-claim';
