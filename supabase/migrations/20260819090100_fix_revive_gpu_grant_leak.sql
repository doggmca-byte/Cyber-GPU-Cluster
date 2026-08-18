-- revive_gpu помилково отримав GRANT для authenticated (застарілий патерн з
-- ранніх міграцій, до restrict_rpc_to_service_role) — цей RPC приймає
-- p_user_id як звичайний параметр без перевірки auth.uid(), тож має бути
-- доступний ЛИШЕ service_role (той самий принцип, що вже двічі виправляли
-- для request_withdrawal/record_ad_watch раніше в цьому проєкті —
-- 20260816213939_fix_public_execute_grant_leak.sql,
-- 20260816220539_fix_deposit_withdraw_grant_leak.sql).
revoke all on function public.revive_gpu(uuid, integer) from public, anon, authenticated;
grant execute on function public.revive_gpu(uuid, integer) to service_role;
