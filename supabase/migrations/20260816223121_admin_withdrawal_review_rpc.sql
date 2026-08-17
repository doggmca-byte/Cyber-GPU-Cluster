-- =====================================================================================
-- Етап 6: обробка pending-заявок на вивід адміном.
--
-- ВАЖЛИВО: у ТЗ сигнатура reject_withdrawal(p_transaction_id BIGINT, ...) —
-- виправлено на UUID, бо transactions.id насправді uuid (BIGINT зламав би
-- кожен виклик з реальним id).
--
-- transactions.status досі не мав значення 'rejected' — додаємо в CHECK.
-- =====================================================================================

alter table public.transactions
    drop constraint transactions_status_check;

alter table public.transactions
    add constraint transactions_status_check
    check (status in ('pending', 'completed', 'failed', 'cancelled', 'rejected'));

-- ------------------------------------------------------------------------------------
-- approve_withdrawal — позначає pending-заявку виконаною і фіксує хеш реальної
-- виплати (адмін відправляє TON вручну зі свого гаманця, потім записує хеш тут).
-- Баланси НЕ змінює — кошти вже зарезервовані (списані) під час request_withdrawal.
-- ------------------------------------------------------------------------------------
create or replace function public.approve_withdrawal(
    p_transaction_id  uuid,
    p_payout_tx_hash  text
)
returns table (
    transaction_id  uuid,
    status          text,
    tx_hash         text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tx record;
begin
    if p_transaction_id is null then
        raise exception 'p_transaction_id is required';
    end if;

    if p_payout_tx_hash is null or length(trim(p_payout_tx_hash)) = 0 then
        raise exception 'p_payout_tx_hash is required' using errcode = 'P0001';
    end if;

    if exists (select 1 from public.transactions where tx_hash = p_payout_tx_hash) then
        raise exception 'payout tx_hash % already recorded on another transaction', p_payout_tx_hash
            using errcode = 'P0001';
    end if;

    select t.id, t.type, t.status into v_tx
        from public.transactions t
        where t.id = p_transaction_id
        for update;

    if not found then
        raise exception 'transaction % not found', p_transaction_id using errcode = 'P0002';
    end if;

    if v_tx.type <> 'withdraw' then
        raise exception 'transaction % is not a withdrawal', p_transaction_id using errcode = 'P0001';
    end if;

    if v_tx.status <> 'pending' then
        raise exception 'transaction % is not pending (status: %)', p_transaction_id, v_tx.status
            using errcode = 'P0001';
    end if;

    update public.transactions
        set status = 'completed',
            tx_hash = p_payout_tx_hash,
            payload = payload || jsonb_build_object('approved_at', now())
        where id = p_transaction_id;

    return query
        select t.id, t.status, t.tx_hash
        from public.transactions t
        where t.id = p_transaction_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- reject_withdrawal — атомарно повертає повну заброньовану суму (і квоту, яку
-- вона з'їла при request_withdrawal) назад користувачу, позначає 'rejected'.
-- ------------------------------------------------------------------------------------
create or replace function public.reject_withdrawal(
    p_transaction_id  uuid,
    p_reason          text
)
returns table (
    transaction_id        uuid,
    status                text,
    refunded_amount       numeric(18, 6),
    withdrawable_balance  numeric(18, 6),
    withdrawal_quota      numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tx             record;
    v_refund_amount  numeric(18, 6);
begin
    if p_transaction_id is null then
        raise exception 'p_transaction_id is required';
    end if;

    if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'p_reason is required' using errcode = 'P0001';
    end if;

    select t.id, t.user_id, t.type, t.status, t.amount into v_tx
        from public.transactions t
        where t.id = p_transaction_id
        for update;

    if not found then
        raise exception 'transaction % not found', p_transaction_id using errcode = 'P0002';
    end if;

    if v_tx.type <> 'withdraw' then
        raise exception 'transaction % is not a withdrawal', p_transaction_id using errcode = 'P0001';
    end if;

    if v_tx.status <> 'pending' then
        raise exception 'transaction % is not pending (status: %)', p_transaction_id, v_tx.status
            using errcode = 'P0001';
    end if;

    -- amount у withdraw-рядках від'ємний (напр. -3.000000) — повертаємо абсолютне
    -- значення і на баланс, і на квоту (яку request_withdrawal так само списав)
    v_refund_amount := abs(v_tx.amount);

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance + v_refund_amount,
            withdrawal_quota = pr.withdrawal_quota + v_refund_amount
        where pr.id = v_tx.user_id;

    update public.transactions
        set status = 'rejected',
            payload = payload || jsonb_build_object('rejection_reason', p_reason, 'rejected_at', now())
        where id = p_transaction_id;

    return query
        select t.id, t.status, v_refund_amount, pr.withdrawable_balance, pr.withdrawal_quota
        from public.transactions t
        join public.profiles pr on pr.id = v_tx.user_id
        where t.id = p_transaction_id;
end;
$$;

revoke all on function public.approve_withdrawal(uuid, text) from public, anon, authenticated;
revoke all on function public.reject_withdrawal(uuid, text) from public, anon, authenticated;

grant execute on function public.approve_withdrawal(uuid, text) to service_role;
grant execute on function public.reject_withdrawal(uuid, text) to service_role;
