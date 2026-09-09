-- =====================================================================================
-- Реферальна комісія з обміну HASH→TON стає ОДНОРАЗОВОЮ.
--
-- Було: 0.01 TON за кожні 1000 HASH нараховувались рефереру ЩОРАЗУ, коли його
-- реферал обмінює HASH на біржі. Тобто один реферал міг годувати реферера
-- нескінченно — достатньо було обмінювати частинами (реально: 344 виплати на
-- 110 пар, 10.23 TON).
--
-- Стало: комісія нараховується РІВНО ОДИН РАЗ на пару (referrer, referee) — на
-- першому обміні цього реферала, за тією ж формулою 0.01 TON / 1000 HASH.
-- Другий і подальші обміни того самого реферала рефереру вже нічого не дають.
--
-- Текст в інтерфейсі НЕ змінюється (свідоме рішення продукту) — для першого
-- обміну він лишається дослівно правдивим.
--
-- Бекфіл: пари, які вже отримували цю комісію, одразу позначаються як
-- "своє вже отримали", інакше після міграції їм капнуло б ще по одному разу.
--
-- Атомарність: прапорець і саме нарахування змінюються ОДНИМ UPDATE із
-- предикатом exchange_commission_paid = false. Два паралельні обміни не
-- можуть заплатити двічі — другий просто не знайде рядок під умову
-- (рядок уже заблокований і оновлений першим).
-- =====================================================================================

alter table public.referrals
    add column if not exists exchange_commission_paid boolean not null default false;

-- Хто вже отримував цю комісію — позначаємо як виплачену.
update public.referrals r
    set exchange_commission_paid = true
    where exists (
        select 1
        from public.transactions t
        where t.type = 'referral_commission'
          and t.payload->>'source' = 'exchange_commission'
          and t.user_id = r.referrer_id
          and t.payload->>'referee_id' = r.referee_id::text
    );

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
    v_referral_commission_step   constant numeric(18, 6) := 0.01;  -- за кожні v_step HASH, ОДИН раз на реферала
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

    -- 2) Реферальна комісія — ОДИН раз на реферала, на його першому обміні.
    -- Предикат exchange_commission_paid = false у WHERE і є тим самим
    -- "замком": повторний обмін (або паралельний) просто не знайде рядка.
    if v_referrer_id is not null then
        v_commission := round((p_hash_amount / v_step) * v_referral_commission_step, 6);

        -- лочимо referrer ДРУГИМ (стабільний порядок з іншими RPC)
        perform 1 from public.profiles where id = v_referrer_id for update;

        update public.referrals
            set pending_reward = pending_reward + v_commission,
                total_earned = total_earned + v_commission,
                exchange_commission_paid = true
            where referrer_id = v_referrer_id
              and referee_id = p_user_id
              and exchange_commission_paid = false;

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
        end if;
        -- else: або комісію за цього реферала вже виплачено (штатний випадок
        -- після переходу на одноразову), або рядка referrals немає — у обох
        -- випадках просто не платимо, обмін це не зриває.
    end if;

    return query
        select p.hash_balance, p.game_balance, p.withdrawable_balance, v_ton_net, v_fee
        from public.profiles p
        where p.id = p_user_id;
end;
$$;
