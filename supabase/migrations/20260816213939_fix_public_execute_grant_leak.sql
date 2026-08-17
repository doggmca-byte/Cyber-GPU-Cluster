-- =====================================================================================
-- Виправлення в межах того самого етапу: попередня міграція (wallet_referrals_ads_rpc)
-- ревокнула EXECUTE лише від anon/authenticated, але не від PUBLIC. Postgres за
-- замовчуванням видає EXECUTE ON FUNCTION ролі PUBLIC при створенні функції — а
-- anon/authenticated неявно успадковують усе, що має PUBLIC, якщо це не відкликано
-- окремо. Той самий клас проблеми, що й у 20260816205809_restrict_rpc_to_service_role.sql,
-- цього разу — власна неуважність, а не Supabase default privileges.
-- =====================================================================================

revoke all on function public.convert_withdrawable_to_game(uuid, numeric) from public;
revoke all on function public.request_withdrawal(uuid, numeric) from public;
revoke all on function public.claim_referral_rewards(uuid) from public;
revoke all on function public.record_ad_watch(uuid) from public;

grant execute on function public.convert_withdrawable_to_game(uuid, numeric) to service_role;
grant execute on function public.request_withdrawal(uuid, numeric) to service_role;
grant execute on function public.claim_referral_rewards(uuid) to service_role;
grant execute on function public.record_ad_watch(uuid) to service_role;
