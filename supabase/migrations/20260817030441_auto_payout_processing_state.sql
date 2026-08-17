-- =====================================================================================
-- Автоматична виплата після Approve: сервер сам підписує й надсилає TON-транзакцію
-- (custodial-гаманець скарбниці), тому потрібен проміжний статус 'processing', щоб
-- атомарно "застовпити" заявку на час відправки в мережу — інакше подвійний клік
-- Approve (або паралельний повторний запит) міг би відправити виплату ДВІЧІ.
--
-- Життєвий цикл: pending -> processing -> completed (успіх)
--                                       \-> pending (відкат, якщо відправка не вдалась)
-- =====================================================================================

alter table public.transactions
    drop constraint transactions_status_check;

alter table public.transactions
    add constraint transactions_status_check
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled', 'rejected'));

-- ------------------------------------------------------------------------------------
-- begin_withdrawal_payout — атомарно "застовплює" pending-заявку під відправку:
-- pending -> processing, і одразу повертає дані, потрібні для відправки TON
-- (адреса, чиста сума), щоб роут не робив окремий SELECT після цього.
-- ------------------------------------------------------------------------------------
create or replace function public.begin_withdrawal_payout(p_transaction_id uuid)
returns table (
    transaction_id        uuid,
    destination_address   text,
    net_payout            numeric(18, 6),
    requested_amount      numeric(18, 6)
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

    select t.id, t.type, t.status, t.amount, t.payload into v_tx
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
        set status = 'processing'
        where id = p_transaction_id;

    return query
        select
            t.id,
            t.payload ->> 'destination_address',
            (t.payload ->> 'net_payout')::numeric(18, 6),
            abs(t.amount)
        from public.transactions t
        where t.id = p_transaction_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- revert_withdrawal_to_pending — відкат 'processing' -> 'pending', коли відправка в
-- мережу не вдалась (гроші НЕ пішли) — заявку можна повторити пізніше. НЕ чіпає
-- баланси (на відміну від reject_withdrawal) — кошти й так ще заброньовані.
-- ------------------------------------------------------------------------------------
create or replace function public.revert_withdrawal_to_pending(
    p_transaction_id  uuid,
    p_reason          text
)
returns table (
    transaction_id  uuid,
    status          text
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

    select t.id, t.status into v_tx
        from public.transactions t
        where t.id = p_transaction_id
        for update;

    if not found then
        raise exception 'transaction % not found', p_transaction_id using errcode = 'P0002';
    end if;

    if v_tx.status <> 'processing' then
        raise exception 'transaction % is not processing (status: %)', p_transaction_id, v_tx.status
            using errcode = 'P0001';
    end if;

    update public.transactions
        set status = 'pending',
            payload = payload || jsonb_build_object('last_payout_error', coalesce(p_reason, 'unknown'))
        where id = p_transaction_id;

    return query
        select t.id, t.status
        from public.transactions t
        where t.id = p_transaction_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- approve_withdrawal: тепер приймає і 'pending' (ручний режим — адмін уже надіслав
-- сам), і 'processing' (авто-режим — щойно застовпили через begin_withdrawal_payout).
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

    if exists (select 1 from public.transactions t where t.tx_hash = p_payout_tx_hash) then
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

    if v_tx.status not in ('pending', 'processing') then
        raise exception 'transaction % cannot be approved (status: %)', p_transaction_id, v_tx.status
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

revoke all on function public.begin_withdrawal_payout(uuid) from public, anon, authenticated;
revoke all on function public.revert_withdrawal_to_pending(uuid, text) from public, anon, authenticated;

grant execute on function public.begin_withdrawal_payout(uuid) to service_role;
grant execute on function public.revert_withdrawal_to_pending(uuid, text) to service_role;
-- approve_withdrawal вже має грант service_role з попередньої міграції — CREATE OR
-- REPLACE зберігає гранти, коли сигнатура не змінюється (перевірю нижче все одно).
