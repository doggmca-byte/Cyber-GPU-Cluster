-- =====================================================================================
-- Найлегший поріг для partner-check API: "просто відкрив застосунок" (профіль
-- взагалі існує) — на відміну від решти умов (own_gpus_count тощо), тут нічого
-- рахувати не треба: evaluate_partner_check_condition і так уже резолвить
-- telegram_id -> v_user_id ДО свого CASE і повертає false, якщо профілю нема.
-- Дійшовши до 'registered' у CASE, профіль за визначенням уже існує.
-- =====================================================================================

alter table public.partner_check_definitions
    drop constraint partner_check_definitions_action_type_check;

alter table public.partner_check_definitions
    add constraint partner_check_definitions_action_type_check
    check (action_type in (
        'registered', 'own_gpus_count', 'own_gpu_level', 'harvest_count',
        'harvest_total_hash', 'deposit_count', 'deposit_total_ton', 'invite_count'
    ));

create or replace function public.evaluate_partner_check_condition(
    p_telegram_id bigint,
    p_action_type text,
    p_target_value text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid;
    v_current numeric;
    v_target  numeric := p_target_value::numeric;
begin
    select pr.id into v_user_id from public.profiles pr where pr.telegram_id = p_telegram_id;
    if v_user_id is null then
        return false;
    end if;

    case p_action_type
        when 'registered' then
            return true;

        when 'own_gpus_count' then
            select coalesce(sum(ug.amount), 0) into v_current
                from public.user_gpus ug where ug.user_id = v_user_id;

        when 'own_gpu_level' then
            select coalesce(sum(ug.amount), 0) into v_current
                from public.user_gpus ug
                where ug.user_id = v_user_id and ug.gpu_level = p_target_value::integer;
            v_target := 1;

        when 'harvest_count' then
            select pr.harvest_count into v_current from public.profiles pr where pr.id = v_user_id;

        when 'harvest_total_hash' then
            select pr.lifetime_hash_generated into v_current from public.profiles pr where pr.id = v_user_id;

        when 'deposit_count' then
            select count(*) into v_current
                from public.transactions t
                where t.user_id = v_user_id and t.type = 'deposit' and t.status = 'completed';

        when 'deposit_total_ton' then
            select pr.lifetime_deposited_ton into v_current from public.profiles pr where pr.id = v_user_id;

        when 'invite_count' then
            select count(*) into v_current from public.referrals r where r.referrer_id = v_user_id;

        else
            return false;
    end case;

    return coalesce(v_current, 0) >= v_target;
end;
$$;

insert into public.partner_check_definitions (slug, action_type, target_value)
values ('cgc-app-open', 'registered', '0')
on conflict (slug) do update
    set action_type  = excluded.action_type,
        target_value = excluded.target_value;
