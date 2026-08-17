-- =====================================================================================
-- Виправлення в межах того самого етапу: попередня міграція зробила лише
-- REVOKE ALL ... FROM PUBLIC, забувши explicit anon/authenticated (Supabase
-- ALTER DEFAULT PRIVILEGES видає їм прямі гранти окремо від PUBLIC). Той самий
-- клас багу, що й у 20260816213939_fix_public_execute_grant_leak.sql — цього
-- разу навпаки: PUBLIC відкликано, anon/authenticated — ні.
--
-- Висновок на майбутнє: REVOKE ALL завжди писати одним рядком для ВСІХ трьох
-- ролей одразу — "revoke all on function ... from public, anon, authenticated;".
-- =====================================================================================

revoke all on function public.process_successful_deposit(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon, authenticated;

grant execute on function public.process_successful_deposit(uuid, numeric, text) to service_role;
grant execute on function public.request_withdrawal(uuid, numeric, text) to service_role;
