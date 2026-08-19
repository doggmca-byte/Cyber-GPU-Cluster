-- =====================================================================================
-- Адмінка: амбасадори + ручні нарахування + реферальна комісія з обміну HASH→TON.
--
--   1) profiles.is_ambassador — прапорець "амбасадор", керується лише адмінкою.
--   2) transactions.is_manual + новий тип 'admin_grant' — ручні нарахування адміна,
--      відокремлені від реальних депозитів ('deposit'), тому НЕ впливають на
--      lifetime_deposited_ton (тір виводу) і НЕ рахуються в "реальні депозити рефералів"
--      (вкладка "Статистика" відбирає лише type = 'deposit').
--   3) admin_grant_balance(...) — RPC ручного нарахування: кредитує ЛИШЕ game_balance
--      (продуктове рішення — без прямого виведення), БЕЗ 5% реф-revshare
--      (на відміну від process_successful_deposit) і БЕЗ lifetime_deposited_ton.
--   4) exchange_hash_to_ton: додано 0.01 TON рефереру за кожні 1000 HASH, які обмінює
--      його реферал (незалежно від p_target_balance) — той самий лок-порядок
--      (referee FOR UPDATE спочатку, потім referrer), що й у решті RPC.
--   5) task_templates.reward_type: усі нагороди за завдання відтепер лише 'game_balance'
--      (звужено CHECK-обмеження, щоб і майбутні завдання не могли нарахувати
--      withdrawable TON / квоту напряму).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) profiles.is_ambassador
-- ------------------------------------------------------------------------------------
alter table public.profiles
    add column if not exists is_ambassador boolean not null default false;

create index if not exists idx_profiles_is_ambassador
    on public.profiles (is_ambassador)
    where is_ambassador;

-- ------------------------------------------------------------------------------------
-- 2) transactions: is_manual + новий тип 'admin_grant'
-- ------------------------------------------------------------------------------------
alter table public.transactions
    add column if not exists is_manual boolean not null default false;

alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim', 'referral_commission', 'task_reward',
        'daily_bonus', 'admin_grant'
    ));

-- ------------------------------------------------------------------------------------
-- 3) admin_grant_balance — ручне нарахування game_balance адміном за telegram_id
--    користувача (сам lookup telegram_id -> profiles.id лишається на боці роуту,
--    RPC приймає вже готовий p_user_id, як і решта функцій).
-- ------------------------------------------------------------------------------------
create or replace function public.admin_grant_balance(
    p_admin_telegram_id  text,
    p_user_id             uuid,
    p_amount              numeric(18, 6)
)
returns table (
    game_balance          numeric(18, 6),
    withdrawable_balance  numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'p_amount must be positive' using errcode = 'P0001';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    update public.profiles as pr
        set game_balance = pr.game_balance + p_amount
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload, is_manual)
    values (
        p_user_id,
        'admin_grant',
        p_amount,
        0,
        'completed',
        jsonb_build_object('granted_by_telegram_id', p_admin_telegram_id, 'is_manual', true),
        true
    );

    return query
        select pr.game_balance, pr.withdrawable_balance
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

revoke all on function public.admin_grant_balance(text, uuid, numeric) from public;
grant execute on function public.admin_grant_balance(text, uuid, numeric) to service_role;

-- ------------------------------------------------------------------------------------
-- 4) exchange_hash_to_ton: + реферальна комісія 0.01 TON за кожні 1000 HASH обміну
--    (той самий алгоритм, що й у 20260818214729_fix_exchange_hash_to_ton_ambiguous_column.sql,
--    плюс блок нарахування referrer'у в кінці).
-- ------------------------------------------------------------------------------------
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
    v_rate                       constant numeric(18, 6) := 0.00001;
    v_min_hash                   constant numeric(18, 6) := 1000;
    v_step                       constant numeric(18, 6) := 1000;
    v_fee_bps                    constant numeric  := 200;
    -- TODO: продуктова константа-заглушка, узгодити фінальну цифру окремо
    v_referral_commission_step   constant numeric(18, 6) := 0.01;  -- за кожні v_step HASH
    v_hash_balance    numeric(18, 6);
    v_referrer_id     uuid;
    v_ton_gross       numeric(18, 6);
    v_fee             numeric(18, 6) := 0;
    v_ton_net         numeric(18, 6);
    v_commission      numeric(18, 6);
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

    -- 1) лочимо referee (викликача) першим — той самий порядок, що й в усіх
    -- інших RPC, що чіпають і referee, і referrer
    select pr.hash_balance, pr.referrer_id into v_hash_balance, v_referrer_id
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

    -- 2) реферальна комісія 0.01 TON / 1000 HASH — лише якщо є referrer.
    -- Нараховується завжди при обміні HASH→TON, незалежно від p_target_balance.
    if v_referrer_id is not null then
        v_commission := round((p_hash_amount / v_step) * v_referral_commission_step, 6);

        -- лочимо referrer ДРУГИМ (стабільний порядок з іншими RPC)
        perform 1 from public.profiles where id = v_referrer_id for update;

        update public.referrals
            set pending_reward = pending_reward + v_commission,
                total_earned = total_earned + v_commission
            where referrer_id = v_referrer_id
              and referee_id = p_user_id;

        if found then
            insert into public.transactions (user_id, type, amount, fee, status, payload)
            values (
                v_referrer_id,
                'referral_commission',
                v_commission,
                0,
                'completed',
                jsonb_build_object(
                    'source', 'exchange_commission',
                    'referee_id', p_user_id,
                    'hash_exchanged', p_hash_amount
                )
            );
        else
            raise notice 'referrals row missing for referrer % / referee % — exchange commission skipped',
                v_referrer_id, p_user_id;
        end if;
    end if;

    return query
        select p.hash_balance, p.game_balance, p.withdrawable_balance, v_ton_net, v_fee
        from public.profiles p
        where p.id = p_user_id;
end;
$$;

-- CREATE OR REPLACE не скидає раніше видані гранти на цю сигнатуру
-- (service_role вже мав EXECUTE з попередніх міграцій) — повторний grant не потрібен.

-- ------------------------------------------------------------------------------------
-- 5) task_templates.reward_type: звужуємо до єдиного дозволеного значення
--    'game_balance' — спершу дані, потім CHECK (інакше ALTER впаде на старих рядках).
-- ------------------------------------------------------------------------------------
update public.task_templates
    set reward_type = 'game_balance'
    where reward_type <> 'game_balance';

alter table public.task_templates
    drop constraint task_templates_reward_type_check;

alter table public.task_templates
    add constraint task_templates_reward_type_check
    check (reward_type = 'game_balance');
