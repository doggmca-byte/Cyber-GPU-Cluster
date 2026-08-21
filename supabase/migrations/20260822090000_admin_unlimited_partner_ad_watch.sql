-- Даємо адміну (перевіряється у JS-шарі через isTelegramAdmin, звіряється
-- з TELEGRAM_ADMIN_IDS -- сам список ніколи не потрапляє в SQL/клієнт) змогу
-- дивитись партнерську рекламу без обмеження денним лімітом — усе інше
-- (інкремент лічильника, нарахування 0.001 TON, запис у transactions)
-- лишається так само, лише перевірка ліміту стає умовною.
--
-- create or replace з НОВОЮ сигнатурою (uuid, boolean) створює ДРУГУ,
-- перевантажену функцію поряд зі старою (uuid) — тому спершу прибираємо
-- стару однопараметричну версію, інакше виклик лише з p_user_id стає
-- неоднозначним між двома кандидатами.
drop function if exists public.record_partner_ad_watch(uuid);

create or replace function public.record_partner_ad_watch(p_user_id uuid, p_bypass_limit boolean default false)
returns table (
    partner_ads_watched_today integer,
    daily_limit                integer,
    reward_amount               numeric(18, 6),
    withdrawable_balance        numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_today          date := (now() at time zone 'utc')::date;
    -- TODO: продуктові константи-заглушки, узгодити фінальні цифри окремо
    v_daily_limit    constant integer := 20;
    v_reward_amount  constant numeric(18, 6) := 0.001;
    v_profile        record;
    v_current        integer;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    select pr.id, pr.partner_ads_watched_today, pr.partner_ads_reset_date
        into v_profile
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    v_current := case when v_profile.partner_ads_reset_date < v_today then 0
                      else v_profile.partner_ads_watched_today end;

    if v_current >= v_daily_limit and not p_bypass_limit then
        raise exception 'daily partner ad limit reached (%/%) — try again tomorrow',
            v_daily_limit, v_daily_limit using errcode = 'P0001';
    end if;

    update public.profiles as pr
        set partner_ads_watched_today = v_current + 1,
            partner_ads_reset_date = v_today,
            withdrawable_balance = pr.withdrawable_balance + v_reward_amount
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'task_reward',
        v_reward_amount,
        0,
        'completed',
        jsonb_build_object('source', 'partner_ad_watch')
    );

    return query
        select pr.partner_ads_watched_today, v_daily_limit, v_reward_amount, pr.withdrawable_balance
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

revoke all on function public.record_partner_ad_watch(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_partner_ad_watch(uuid, boolean) to service_role;
