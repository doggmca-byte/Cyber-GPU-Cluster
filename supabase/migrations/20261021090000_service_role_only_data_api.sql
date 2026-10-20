-- =====================================================================================
-- Data API доступ лише для service_role.
--
-- З 30.10.2026 Supabase перестає автоматично видавати гранти на НОВІ таблиці в public.
-- Застосунок ходить у БД тільки з сервера через service_role (lib/supabase/admin.ts);
-- anon/authenticated клієнти (lib/supabase/client.ts, server.ts) ніде не імпортуються,
-- а anon-ключ публічний (NEXT_PUBLIC_*), тож будь-який грант для anon = доступ для всіх.
--
-- 1) Default privileges: усе, що postgres створює в public (таблиці, сіквенси, функції),
--    отримує гранти ТІЛЬКИ для service_role — і до, і після змін Supabase.
--    Заодно закриває клас "grant leak" для функцій (див. 20260816220539): anon/authenticated
--    більше не отримують EXECUTE автоматично. REVOKE ... FROM PUBLIC для функцій
--    усе одно потрібен — це глобальний дефолт Postgres, per-schema його не прибрати.
-- 2) Існуючі таблиці/сіквенси: знімаємо гранти з anon/authenticated (RLS лишається
--    як другий рубіж). Політики *_select_all на gpu_templates / task_templates /
--    retention_task_stage_config після цього через anon-ключ недоступні — і не потрібні.
--
-- Правило для нових міграцій: у тій самій міграції, що створює таблицю, писати
--   alter table public.<t> enable row level security;
--   grant select, insert, update, delete on public.<t> to service_role;
-- =====================================================================================

-- 1) Майбутні об'єкти
alter default privileges for role postgres in schema public
    revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all on functions from anon, authenticated;

alter default privileges for role postgres in schema public
    grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
    grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
    grant execute on functions to service_role;

-- 2) Існуючі об'єкти
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
