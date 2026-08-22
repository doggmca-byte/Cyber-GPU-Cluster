-- Баг: total_earned нараховувався ДВІЧІ на кожну реферальну комісію — один
-- раз у момент заробітку (process_successful_deposit/harvest_user_hash/
-- exchange_hash_to_ton, усі коректно роблять total_earned += commission
-- одразу поряд з pending_reward += commission), і ЩЕ РАЗ тут, у
-- claim_referral_rewards, при переведенні pending_reward -> withdrawable_balance.
-- Гроші (withdrawable_balance/transactions) це не чіпало — лише
-- статистичне поле referrals.total_earned, яке підсумовується в
-- /api/friends/stats і показується як "Заработано всего" на екрані Друзі
-- (удвічі завищене для будь-кого, хто хоч раз клеймив реферальні нагороди).
create or replace function public.claim_referral_rewards(p_user_id uuid)
returns table (
    claimed_amount        numeric(18, 6),
    withdrawable_balance  numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_total_pending numeric(18, 6) := 0;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    perform 1 from public.referrals
        where referrer_id = p_user_id and pending_reward > 0
        for update;

    select coalesce(sum(r.pending_reward), 0) into v_total_pending
        from public.referrals r
        where r.referrer_id = p_user_id;

    if v_total_pending <= 0 then
        raise exception 'nothing to claim' using errcode = 'P0001';
    end if;

    update public.referrals
        set pending_reward = 0
        where referrer_id = p_user_id
          and pending_reward > 0;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance + v_total_pending
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'referral_claim', v_total_pending, 0, 'completed',
            jsonb_build_object('source', 'referral_commission'));

    return query
        select v_total_pending, p.withdrawable_balance
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- Виправляємо вже зіпсовані задвоєнням дані: перераховуємо total_earned з
-- реального логу transactions (type='referral_commission') — там кожна
-- комісія записана рівно один раз, незалежно від бага вище.
update public.referrals r
set total_earned = coalesce((
    select sum(t.amount) from public.transactions t
    where t.user_id = r.referrer_id
      and t.type = 'referral_commission'
      and t.payload->>'referee_id' = r.referee_id::text
), 0)
where r.total_earned > 0;
