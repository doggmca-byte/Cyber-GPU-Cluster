-- =====================================================================================
-- Виправлення: Supabase за замовчуванням видає anon/authenticated пряме EXECUTE на нові
-- функції в public через ALTER DEFAULT PRIVILEGES (окремо від гранту через PUBLIC).
-- REVOKE ALL ... FROM PUBLIC у попередній міграції цього не прибирав.
--
-- Наші RPC приймають p_user_id як звичайний параметр і НЕ перевіряють auth.uid(), тому
-- виклик має бути можливий лише від довіреного backend через service_role ключ
-- (backend сам перевіряє підпис Telegram initData і підставляє правильний user_id).
-- Публічний anon/authenticated доступ до цих функцій відкриває можливість змінювати
-- баланс будь-якого користувача.
-- =====================================================================================

revoke execute on function public.harvest_user_hash(uuid) from anon, authenticated;
revoke execute on function public.buy_gpu(uuid, integer) from anon, authenticated;
revoke execute on function public.exchange_hash_to_ton(uuid, numeric, text) from anon, authenticated;

-- лишається лише service_role (+ postgres, власник)
grant execute on function public.harvest_user_hash(uuid) to service_role;
grant execute on function public.buy_gpu(uuid, integer) to service_role;
grant execute on function public.exchange_hash_to_ton(uuid, numeric, text) to service_role;
