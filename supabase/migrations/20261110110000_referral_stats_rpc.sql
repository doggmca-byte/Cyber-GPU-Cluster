-- Статистика рефералів для екрана "Друзі" — агрегація в SQL, а не в JS.
--
-- Баг: /api/friends/stats тягнув усі рядки referrals через PostgREST і сумував
-- у JS, але PostgREST віддає максимум 1000 рядків за запит (Supabase
-- db_max_rows = 1000), а запит був без пагінації й без ORDER BY. У рефовода з
-- 1668 рефералами friends_count/total_earned/pending_reward рахувались лише по
-- першій тисячі рядків у довільному порядку: екран показав 0.01 TON "до
-- отримання", а claim_referral_rewards (який сумує в SQL) виплатив реальні
-- 0.408 TON. Побічно: "Запрошено друзів" впиралось у 1000, а кнопка "Забрати"
-- блокувалась (disabled при pending_reward <= 0), якщо всі накопичення лежали
-- за межами першої тисячі.
--
-- Виплату це не чіпало — лише відображення. Тут нічого не нараховується.
create or replace function public.get_referral_stats(p_user_id uuid)
returns table (
    friends_count  bigint,
    total_earned   numeric(18, 6),
    pending_reward numeric(18, 6)
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select count(*)::bigint,
           coalesce(sum(r.total_earned), 0)::numeric(18, 6),
           coalesce(sum(r.pending_reward), 0)::numeric(18, 6)
    from public.referrals r
    where r.referrer_id = p_user_id;
$$;

-- PUBLIC теж треба відкликати: anon/authenticated неявно успадковують його
-- EXECUTE (той самий клас проблеми, що в 20260816213939_fix_public_execute_grant_leak.sql).
revoke all on function public.get_referral_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_referral_stats(uuid) to service_role;
