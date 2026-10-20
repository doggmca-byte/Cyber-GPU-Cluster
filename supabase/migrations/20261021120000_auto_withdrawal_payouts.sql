-- =====================================================================================
-- Автовиплати: кожна заявка на вивід обробляється одразу після створення, без адміна.
--
-- Воркер (lib/ton/payoutWorker.ts) запускається після request_withdrawal (after()),
-- з кнопки "Авто" в адмінці і кроном щохвилини як страховка. Виплати йдуть строго
-- по одній: наступна не відправляється, поки попередня не підтверджена в мережі або
-- її повідомлення гарантовано не прострочене.
--
-- Звідки могла взятись подвійна виплата у старій схемі: підписане повідомлення
-- гаманця V5R1 дійсне 60 с, а код чекав підтвердження лише 24 с і відкочував заявку
-- в pending. Повторна спроба вже з НОВИМ seqno + запізніле перше повідомлення =
-- два перекази. Тепер заявка повертається в pending ЛИШЕ коли valid_until минув
-- (повідомлення фізично не може бути прийняте) і в історії гаманця немає переказу
-- з її id у коментарі.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- Замок з орендою (lease) у system_jobs. claim_job тут не підходить: він обмежує
-- частоту, а потрібна взаємовиключність — один воркер на гаманець у будь-який момент.
-- Оренда сама спливає, якщо Vercel обірвав функцію і release не викликався.
-- ------------------------------------------------------------------------------------
alter table public.system_jobs
    add column if not exists locked_until  timestamptz,
    add column if not exists locked_by     text;

insert into public.system_jobs (name) values ('withdrawal_payouts')
on conflict (name) do nothing;

create or replace function public.acquire_job_lock(p_name text, p_holder text, p_lease_seconds integer)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    with claimed as (
        update public.system_jobs
            set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
                locked_by    = p_holder,
                last_run_at  = now()
            where name = p_name
              and (locked_until is null or locked_until < now())
            returning 1
    )
    select exists (select 1 from claimed);
$$;

create or replace function public.release_job_lock(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.system_jobs
        set locked_until = null,
            locked_by    = null
        where name = p_name
          and locked_by = p_holder;
$$;

-- ------------------------------------------------------------------------------------
-- begin_auto_withdrawal_payout — pending -> processing і В ТІЙ САМІЙ транзакції
-- записує, з яким seqno і до якого часу дійсне повідомлення, яке зараз піде в мережу.
-- Запис робиться ДО відправки: якщо функцію обірвуть посередині, звірка все одно
-- знає, коли повідомлення гарантовано прострочене.
-- ------------------------------------------------------------------------------------
create or replace function public.begin_auto_withdrawal_payout(
    p_transaction_id  uuid,
    p_seqno           bigint,
    p_valid_until     timestamptz
)
returns table (
    transaction_id       uuid,
    destination_address  text,
    net_payout           numeric(18, 6),
    attempt              integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tx       record;
    v_attempt  integer;
begin
    if p_transaction_id is null or p_seqno is null or p_valid_until is null then
        raise exception 'p_transaction_id, p_seqno and p_valid_until are required';
    end if;

    select t.id, t.type, t.status, t.payload into v_tx
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

    v_attempt := coalesce((v_tx.payload ->> 'payout_attempts')::integer, 0) + 1;

    update public.transactions
        set status  = 'processing',
            payload = payload || jsonb_build_object(
                'payout_attempts', v_attempt,
                'payout_attempt', jsonb_build_object(
                    'seqno', p_seqno,
                    'valid_until', p_valid_until,
                    'started_at', now()
                )
            )
        where id = p_transaction_id;

    return query
        select
            t.id,
            t.payload ->> 'destination_address',
            (t.payload ->> 'net_payout')::numeric(18, 6),
            v_attempt
        from public.transactions t
        where t.id = p_transaction_id;
end;
$$;

revoke all on function public.acquire_job_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_job_lock(text, text) from public, anon, authenticated;
revoke all on function public.begin_auto_withdrawal_payout(uuid, bigint, timestamptz) from public, anon, authenticated;

grant execute on function public.acquire_job_lock(text, text, integer) to service_role;
grant execute on function public.release_job_lock(text, text) to service_role;
grant execute on function public.begin_auto_withdrawal_payout(uuid, bigint, timestamptz) to service_role;
