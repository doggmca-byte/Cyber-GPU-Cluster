-- =====================================================================================
-- Виправлення claim_task_reward: ON CONFLICT (user_id, task_id) — Postgres резолвить
-- перелік колонок у дужках як вираз, і "task_id" виявляється неоднозначним між
-- OUT-параметром p_task_id/task_id функції та колонкою user_tasks.task_id
-- (ERROR 42702, спіймано живим SQL-тестом одразу після першого apply_migration).
--
-- Фікс: ON CONFLICT ON CONSTRAINT user_tasks_user_task_uq — без переліку колонок,
-- тож ambiguity просто нема звідки взятись.
-- =====================================================================================

create or replace function public.claim_task_reward(
    p_user_id uuid,
    p_task_id uuid
)
returns table (
    task_id               uuid,
    status                text,
    reward_amount         numeric(18, 6),
    reward_type           text,
    game_balance          numeric(18, 6),
    withdrawable_balance  numeric(18, 6),
    withdrawal_quota      numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_task           public.task_templates%rowtype;
    v_user_task      record;
    v_condition_met  boolean := false;
    v_current_value  numeric;
    v_target_value   numeric;
begin
    if p_user_id is null or p_task_id is null then
        raise exception 'p_user_id and p_task_id are required';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select tt.* into v_task
        from public.task_templates tt
        where tt.id = p_task_id
          and tt.is_active
        for update;

    if not found then
        raise exception 'task % not found or inactive', p_task_id using errcode = 'P0002';
    end if;

    insert into public.user_tasks (user_id, task_id)
    values (p_user_id, p_task_id)
    on conflict on constraint user_tasks_user_task_uq do nothing;

    select ut.* into v_user_task
        from public.user_tasks ut
        where ut.user_id = p_user_id
          and ut.task_id = p_task_id
        for update;

    if v_user_task.status = 'claimed' then
        raise exception 'task % already claimed', p_task_id using errcode = 'P0001';
    end if;

    if v_user_task.status = 'completed' then
        v_condition_met := true;
    else
        case v_task.action_type
            when 'own_gpus_count' then
                select coalesce(sum(ug.amount), 0) into v_current_value
                    from public.user_gpus ug
                    where ug.user_id = p_user_id;
                v_target_value := v_task.target_value::numeric;
                v_condition_met := v_current_value >= v_target_value;

            when 'harvest_count' then
                select pr.harvest_count into v_current_value
                    from public.profiles pr
                    where pr.id = p_user_id;
                v_target_value := v_task.target_value::numeric;
                v_condition_met := v_current_value >= v_target_value;

            when 'invite_count' then
                select count(*) into v_current_value
                    from public.referrals r
                    where r.referrer_id = p_user_id;
                v_target_value := v_task.target_value::numeric;
                v_condition_met := v_current_value >= v_target_value;

            when 'deposit_count' then
                select count(*) into v_current_value
                    from public.transactions t
                    where t.user_id = p_user_id
                      and t.type = 'deposit'
                      and t.status = 'completed';
                v_target_value := v_task.target_value::numeric;
                v_condition_met := v_current_value >= v_target_value;

            else
                v_condition_met := false;
        end case;

        if not v_condition_met then
            raise exception 'task condition not met yet' using errcode = 'P0001';
        end if;
    end if;

    if v_task.reward_type = 'game_balance' then
        update public.profiles as pr
            set game_balance = pr.game_balance + v_task.reward_amount
            where pr.id = p_user_id;
    elsif v_task.reward_type = 'ton' then
        update public.profiles as pr
            set withdrawable_balance = pr.withdrawable_balance + v_task.reward_amount
            where pr.id = p_user_id;
    elsif v_task.reward_type = 'quota' then
        update public.profiles as pr
            set withdrawal_quota = pr.withdrawal_quota + v_task.reward_amount
            where pr.id = p_user_id;
    else
        raise exception 'unknown reward_type %', v_task.reward_type;
    end if;

    update public.user_tasks as ut
        set status = 'claimed',
            claimed_at = now(),
            updated_at = now()
        where ut.user_id = p_user_id
          and ut.task_id = p_task_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'task_reward',
        v_task.reward_amount,
        0,
        'completed',
        jsonb_build_object(
            'task_id', p_task_id,
            'category', v_task.category,
            'reward_type', v_task.reward_type
        )
    );

    return query
        select
            v_task.id,
            'claimed'::text,
            v_task.reward_amount,
            v_task.reward_type,
            pr.game_balance,
            pr.withdrawable_balance,
            pr.withdrawal_quota
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

-- CREATE OR REPLACE зберігає раніше видані GRANT — повторний revoke/grant не потрібен.
