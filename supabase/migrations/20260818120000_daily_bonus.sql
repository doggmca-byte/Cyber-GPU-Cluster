-- =====================================================================================
-- Щоденна нагорода (Daily Bonus).
--
-- Той самий підхід атомарності, що й у решті RPC (Етап 1/4): SELECT ... FOR UPDATE
-- на profiles.id як персональний м'ютекс, перевірка кулдауну виконується вже на
-- заблокованому рядку — паралельні виклики claim_daily_bonus для одного й того ж
-- користувача серіалізуються, друга транзакція завжди бачить вже оновлений
-- last_daily_bonus_at і отримує 'Cooldown active' — подвійне нарахування неможливе
-- (та сама гарантія, що покрила b/w race у harvest_user_hash/buy_gpu раніше).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) profiles.last_daily_bonus_at
-- ------------------------------------------------------------------------------------
alter table public.profiles
    add column if not exists last_daily_bonus_at timestamptz default null;

-- ------------------------------------------------------------------------------------
-- 2) transactions.type: додаємо 'daily_bonus'
-- ------------------------------------------------------------------------------------
alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim', 'referral_commission', 'task_reward',
        'daily_bonus'
    ));

-- ------------------------------------------------------------------------------------
-- 3) claim_daily_bonus(p_user_id, p_reward_amount)
--
--    Доступність: бонус можна забрати, щойно минуло >= 24 год з last_daily_bonus_at
--    АБО настав новий календарний день UTC — те з двох, що настає РАНІШЕ (типова
--    daily-reward механіка: гарантоване скидання не пізніше опівночі UTC, навіть
--    якщо повних 24 год від попереднього кліку ще не минуло). "Cooldown active" —
--    негація цієї умови: обидва "не настали" одночасно.
--
--    p_reward_amount передається з бекенду (а не читається з константи в SQL), щоб
--    сума нагороди лишалась єдиним джерелом правди на клієнті/сервері
--    (lib/constants/economy.ts DAILY_BONUS_REWARD_TON) без дублювання в БД —
--    той самий підхід, що exchange_hash_to_ton/request_withdrawal використовують
--    для власних параметрів.
-- ------------------------------------------------------------------------------------
create or replace function public.claim_daily_bonus(
    p_user_id       uuid,
    p_reward_amount numeric(18, 6)
)
returns table (
    game_balance         numeric(18, 6),
    withdrawable_balance numeric(18, 6),
    last_daily_bonus_at  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_last_claim timestamptz;
    v_now        timestamptz := clock_timestamp();
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_reward_amount is null or p_reward_amount <= 0 then
        raise exception 'p_reward_amount must be positive' using errcode = 'P0001';
    end if;

    select pr.last_daily_bonus_at into v_last_claim
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if v_last_claim is not null
       and v_now - v_last_claim < interval '24 hours'
       and date_trunc('day', v_now at time zone 'utc') = date_trunc('day', v_last_claim at time zone 'utc')
    then
        raise exception 'Cooldown active' using errcode = 'P0001';
    end if;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance + p_reward_amount,
            last_daily_bonus_at = v_now
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'daily_bonus', p_reward_amount, 0, 'completed',
            jsonb_build_object('source', 'daily_bonus_claim'));

    return query
        select pr.game_balance, pr.withdrawable_balance, pr.last_daily_bonus_at
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 4) Гранти: лише service_role (той самий шаблон, що й решта RPC — Supabase
--    інакше автоматично видає EXECUTE anon/authenticated через ALTER DEFAULT
--    PRIVILEGES, див. 20260816205809_restrict_rpc_to_service_role.sql).
-- ------------------------------------------------------------------------------------
revoke all on function public.claim_daily_bonus(uuid, numeric) from public, anon, authenticated;
grant execute on function public.claim_daily_bonus(uuid, numeric) to service_role;
