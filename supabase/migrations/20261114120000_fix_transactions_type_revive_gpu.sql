-- Фікс: public.revive_gpu пише в transactions рядок з type = 'revive_gpu', а живий CHECK
-- transactions_type_check цього типу не містив. Перший же гравець, що натиснув би
-- "Оживити", отримав би 500 (check_violation) і відкат усієї транзакції.
--
-- Як так вийшло: 20260819090000 додала 'revive_gpu' до списку, але наступні міграції
-- (20260819130000, 20260825090000, 20260829090000) перестворювали constraint із власним
-- списком і тип губився. Станом на 2026-11-14 оживлень ще не було (revival_count > 0 у
-- 0 рядків user_gpus, type = 'revive_gpu' у 0 рядків transactions) — зламане нікому не
-- зашкодило.
--
-- Змінюємо ТІЛЬКИ цей constraint: список 1-в-1 як у проді + 'revive_gpu'. Функції
-- (revive_gpu, buy_gpu, ...) не чіпаємо. Старий список — підмножина нового, тож наявні
-- рядки гарантовано проходять перевірку.
--
-- NOT VALID + окремий VALIDATE: DROP/ADD під ACCESS EXCLUSIVE тримається миттєво (без
-- скану ~97 тис. рядків), а сам скан іде під SHARE UPDATE EXCLUSIVE і не блокує запис.
set local lock_timeout = '5s';

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
    add constraint transactions_type_check check (type = any (array[
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance', 'purchase_gpu',
        'referral_claim', 'referral_commission', 'task_reward', 'daily_bonus',
        'admin_grant', 'task_penalty', 'retention_task_reward', 'revive_gpu'
    ]::text[])) not valid;

alter table public.transactions validate constraint transactions_type_check;
