-- =====================================================================================
-- Сканування депозитів при відкритті застосунку (замість лише раз на добу).
--
-- Знайдено аудитом 11.09: депозит із правильним мемо лежав незарахованим
-- кілька годин, бо гравець переказав вручну (адреса + мемо) і не натиснув
-- "Перевірити оплату". Єдиний бекстоп для такого сценарію — крон
-- /api/cron/deposits — на Vercel Hobby йде раз на добу (03:00 UTC), а обидва
-- дозволені слоти кронів уже зайняті. Тобто затримка сягала майже доби.
--
-- Тепер /api/user/sync, ПІСЛЯ відправки відповіді (next/server after()),
-- запускає той самий скан скарбниці. Щоб сотні входів на день не гатили
-- toncenter, скан захищено атомарним "замком" claim_job: виграє рівно один
-- виклик за інтервал, решта одразу отримують false і нічого не роблять.
-- =====================================================================================

create table if not exists public.system_jobs (
    name         text primary key,
    last_run_at  timestamptz not null default 'epoch'
);

alter table public.system_jobs enable row level security;
-- Політик навмисно немає: лише бекенд із service_role.

insert into public.system_jobs (name) values ('deposit_scan')
on conflict (name) do nothing;

-- ------------------------------------------------------------------------------------
-- claim_job — true лише для ОДНОГО виклику за інтервал.
--
-- Атомарність дає сам UPDATE: паралельний виклик чекає на блокування рядка,
-- а в READ COMMITTED після розблокування заново перевіряє WHERE вже проти
-- оновленого last_run_at — умова стає хибною, і він отримує false. Тож два
-- одночасні входи не запустять два скани.
-- ------------------------------------------------------------------------------------
create or replace function public.claim_job(p_name text, p_min_interval_seconds integer)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    with claimed as (
        update public.system_jobs
            set last_run_at = now()
            where name = p_name
              and last_run_at < now() - make_interval(secs => greatest(p_min_interval_seconds, 1))
            returning 1
    )
    select exists (select 1 from claimed);
$$;

revoke all on function public.claim_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_job(text, integer) to service_role;
