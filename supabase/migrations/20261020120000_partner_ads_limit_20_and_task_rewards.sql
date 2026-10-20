-- =====================================================================================
-- 1) Денний ліміт партнерської реклами 30 -> 20 (record_partner_ad_watch; решта
--    функції без змін, див. 20260904090000_raise_partner_ad_daily_limit_to_30.sql).
--    Сюди ж рахуються виконання AdsGram Task (/api/ads/adsgram-postback?type=task),
--    які додатково обмежені 10/добу в самому роуті.
-- 2) Нагороди завдань: підписки на канал/чат/канал виплат 0.02 -> 0.01,
--    "Запроси друзів" — рівно вдвічі менше (0.05/0.1/0.25 -> 0.025/0.05/0.125).
-- =====================================================================================
create or replace function public.record_partner_ad_watch(p_user_id uuid, p_bypass_limit boolean default false)
returns table (
    partner_ads_watched_today integer,
    daily_limit               integer,
    reward_amount              numeric,
    withdrawable_balance       numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_today          date := (now() at time zone 'utc')::date;
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

update public.task_templates set reward_amount = 0.01
    where title_key in ('subscribe_channel', 'subscribe_chat', 'subscribe_payouts_channel');
update public.task_templates set reward_amount = 0.025 where title_key = 'invite_1';
update public.task_templates set reward_amount = 0.05  where title_key = 'invite_5';
update public.task_templates set reward_amount = 0.125 where title_key = 'invite_20';
