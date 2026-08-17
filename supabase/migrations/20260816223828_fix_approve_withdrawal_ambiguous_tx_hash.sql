-- =====================================================================================
-- Виправлення знайденого live smoke-тестом бага: approve_withdrawal мала
-- `if exists (select 1 from public.transactions where tx_hash = p_payout_tx_hash)`
-- — некваліфіковане tx_hash, скопійоване з process_successful_deposit, де
-- такої колізії не було (там tx_hash не є вихідною колонкою функції). Тут
-- approve_withdrawal.RETURNS TABLE(..., tx_hash text) — колізія, "column
-- reference tx_hash is ambiguous". Виправлено додаванням аліасу таблиці.
-- =====================================================================================

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

revoke all on function public.approve_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_withdrawal(uuid, text) to service_role;
