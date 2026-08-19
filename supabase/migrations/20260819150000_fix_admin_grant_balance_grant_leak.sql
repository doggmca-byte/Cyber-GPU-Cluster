-- =====================================================================================
-- КРИТИЧНИЙ ФІКС: admin_grant_balance (20260819130000_...) робив лише
-- `revoke all ... from public`, що НЕ прибирає окремий грант, який Supabase
-- видає anon/authenticated напряму через ALTER DEFAULT PRIVILEGES при
-- створенні нової функції в public — той самий клас діри, що й у
-- 20260816205809_restrict_rpc_to_service_role.sql /
-- 20260816213939_fix_public_execute_grant_leak.sql / 20260816220539 /
-- 20260819090100_fix_revive_gpu_grant_leak.sql.
--
-- Наслідок ДО цього фіксу: будь-який клієнт із публічним anon-ключем міг
-- викликати admin_grant_balance(text, uuid, numeric) напряму через PostgREST
-- RPC, обходячи requireAdminAuth() у Next.js повністю, і нарахувати
-- довільну суму game_balance будь-якому user_id.
-- =====================================================================================

revoke execute on function public.admin_grant_balance(text, uuid, numeric) from anon, authenticated;

grant execute on function public.admin_grant_balance(text, uuid, numeric) to service_role;
