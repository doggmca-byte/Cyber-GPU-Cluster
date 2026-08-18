-- Фікс: RETURNS TABLE(hash_balance, game_balance, withdrawable_balance, ...)
-- неявно оголошує OUT-параметри з тими самими іменами, що й колонки
-- public.profiles. Непрефіксовані посилання на них у правій частині
-- UPDATE ... SET (hash_balance = hash_balance - ..., withdrawable_balance =
-- withdrawable_balance + ...) були неоднозначні (42702 "column reference is
-- ambiguous") — Postgres не міг визначити: колонка таблиці чи OUT-змінна.
-- Виправлення: аліас pr + явна квалфікація pr.col у правій частині — той
-- самий патерн, що вже використовують harvest_user_hash/
-- process_successful_deposit/record_ad_watch/request_withdrawal.

create or replace function public.exchange_hash_to_ton(
    p_user_id           uuid,
    p_hash_amount       numeric(18, 6),
    p_target_balance    text
)
returns table (
    hash_balance            numeric(18, 6),
    game_balance            numeric(18, 6),
    withdrawable_balance    numeric(18, 6),
    ton_credited            numeric(18, 6),
    fee_charged             numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_rate            constant numeric(18, 6) := 0.00001;
    v_min_hash        constant numeric(18, 6) := 1000;
    v_step            constant numeric(18, 6) := 1000;
    v_fee_bps         constant numeric  := 200;
    v_hash_balance    numeric(18, 6);
    v_ton_gross       numeric(18, 6);
    v_fee             numeric(18, 6) := 0;
    v_ton_net         numeric(18, 6);
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_hash_amount is null or p_hash_amount < v_min_hash then
        raise exception 'p_hash_amount must be at least % HASH', v_min_hash
            using errcode = 'P0001';
    end if;

    if mod(p_hash_amount, v_step) <> 0 then
        raise exception 'p_hash_amount must be a multiple of % HASH', v_step
            using errcode = 'P0001';
    end if;

    if p_target_balance not in ('withdrawable_balance', 'game_balance') then
        raise exception 'invalid p_target_balance: %', p_target_balance;
    end if;

    select pr.hash_balance into v_hash_balance
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if v_hash_balance < p_hash_amount then
        raise exception 'insufficient hash_balance: has %, needs %',
            v_hash_balance, p_hash_amount
            using errcode = 'P0001';
    end if;

    v_ton_gross := round(p_hash_amount * v_rate, 6);

    if p_target_balance = 'withdrawable_balance' then
        v_fee := round(v_ton_gross * v_fee_bps / 10000, 6);
    end if;

    v_ton_net := v_ton_gross - v_fee;

    if p_target_balance = 'withdrawable_balance' then
        update public.profiles as pr
            set hash_balance = pr.hash_balance - p_hash_amount,
                withdrawable_balance = pr.withdrawable_balance + v_ton_net
            where pr.id = p_user_id;
    else
        update public.profiles as pr
            set hash_balance = pr.hash_balance - p_hash_amount,
                game_balance = pr.game_balance + v_ton_net
            where pr.id = p_user_id;
    end if;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'exchange_hash',
        v_ton_net,
        v_fee,
        'completed',
        jsonb_build_object(
            'hash_spent', p_hash_amount,
            'target_balance', p_target_balance,
            'rate', v_rate
        )
    );

    return query
        select p.hash_balance, p.game_balance, p.withdrawable_balance, v_ton_net, v_fee
        from public.profiles p
        where p.id = p_user_id;
end;
$$;
