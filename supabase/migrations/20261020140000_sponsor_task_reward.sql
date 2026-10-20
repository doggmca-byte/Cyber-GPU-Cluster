-- =====================================================================================
-- Нагорода за спонсорські завдання (AdsGram Task, банер TADS): 0.001 TON на
-- withdrawable_balance, як за партнерську рекламу, але БЕЗ денного ліміту і БЕЗ
-- лічильника partner_ads_watched_today — ці завдання не з'їдають ліміт
-- "Дивись рекламу партнерів" (20/добу). Скільки завдань показати, вирішує сам
-- провайдер. Викликає lib/ads/sponsorReward.ts лише з S2S-постбеків під секретом.
-- =====================================================================================
create or replace function public.record_sponsor_task_reward(p_user_id uuid, p_source text)
returns table (withdrawable_balance numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_reward_amount constant numeric(18, 6) := 0.001;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance + v_reward_amount
        where pr.id = p_user_id;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'task_reward', v_reward_amount, 0, 'completed', jsonb_build_object('source', p_source));

    return query select pr.withdrawable_balance from public.profiles pr where pr.id = p_user_id;
end;
$$;

revoke all on function public.record_sponsor_task_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.record_sponsor_task_reward(uuid, text) to service_role;
