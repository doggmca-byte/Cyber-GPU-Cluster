-- Виправлення реального бага, знайденого живим SQL-тестуванням одразу
-- після 20260829090000_special_retention_tasks.sql: колонки таблиць
-- (task_type, current_stage, is_active, stage_started_at) збігаються за
-- іменем з вихідними колонками RETURNS TABLE обох функцій — PL/pgSQL
-- трактує ЦІ ІМЕНА як неявно оголошені змінні у скоупі всієї функції, тож
-- будь-яке НЕкваліфіковане посилання на них у WHERE/SELECT INTO стає
-- неоднозначним ("column reference is ambiguous", ERRCODE 42702) — саме це
-- й трапилось на першому ж виклику start_retention_task_stage. Фікс: усюди
-- явні аліаси таблиць (urt/rtc) замість голого public.user_retention_tasks/
-- retention_task_stage_config.

create or replace function public.start_retention_task_stage(
    p_user_id uuid,
    p_task_type text,
    p_condition_met boolean
)
returns table (
    task_type              text,
    current_stage          int,
    is_active              boolean,
    stage_started_at       timestamptz,
    stage_duration_seconds int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row       public.user_retention_tasks%rowtype;
    v_stage_cfg public.retention_task_stage_config%rowtype;
begin
    if p_user_id is null or p_task_type is null or p_condition_met is null then
        raise exception 'p_user_id, p_task_type and p_condition_met are required';
    end if;

    if p_task_type not in ('NAME_TAG', 'BIO_LINK') then
        raise exception 'invalid task_type %', p_task_type using errcode = 'P0001';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    insert into public.user_retention_tasks (user_id, task_type)
    values (p_user_id, p_task_type)
    on conflict on constraint user_retention_tasks_user_task_uq do nothing;

    select urt.* into v_row
        from public.user_retention_tasks urt
        where urt.user_id = p_user_id and urt.task_type = p_task_type
        for update;

    if v_row.is_active then
        raise exception 'stage already active' using errcode = 'P0001';
    end if;

    if v_row.current_stage > 6 then
        raise exception 'all stages already completed' using errcode = 'P0001';
    end if;

    if not p_condition_met then
        raise exception 'condition not met yet' using errcode = 'P0001';
    end if;

    select rtc.* into v_stage_cfg
        from public.retention_task_stage_config rtc
        where rtc.task_type = p_task_type and rtc.stage = v_row.current_stage;

    if not found then
        raise exception 'stage config missing for % stage %', p_task_type, v_row.current_stage using errcode = 'P0002';
    end if;

    update public.user_retention_tasks urt
        set is_active = true,
            stage_started_at = now(),
            last_verified_at = now(),
            updated_at = now()
        where urt.user_id = p_user_id and urt.task_type = p_task_type;

    return query
        select ur.task_type, ur.current_stage, ur.is_active, ur.stage_started_at, v_stage_cfg.duration_seconds::int
        from public.user_retention_tasks ur
        where ur.user_id = p_user_id and ur.task_type = p_task_type;
end;
$$;

create or replace function public.verify_retention_task_stage(
    p_user_id uuid,
    p_task_type text,
    p_condition_met boolean
)
returns table (
    success               boolean,
    task_type             text,
    current_stage         int,
    is_active             boolean,
    stage_started_at      timestamptz,
    is_fully_completed    boolean,
    reward_credited       numeric(18, 6),
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
    v_row        public.user_retention_tasks%rowtype;
    v_stage_cfg  public.retention_task_stage_config%rowtype;
    v_reward     numeric(18, 6);
begin
    if p_user_id is null or p_task_type is null or p_condition_met is null then
        raise exception 'p_user_id, p_task_type and p_condition_met are required';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select urt.* into v_row
        from public.user_retention_tasks urt
        where urt.user_id = p_user_id and urt.task_type = p_task_type
        for update;

    if not found or not v_row.is_active then
        raise exception 'task stage is not active' using errcode = 'P0001';
    end if;

    select rtc.* into v_stage_cfg
        from public.retention_task_stage_config rtc
        where rtc.task_type = p_task_type and rtc.stage = v_row.current_stage;

    if not found then
        raise exception 'stage config missing for % stage %', p_task_type, v_row.current_stage using errcode = 'P0002';
    end if;

    if now() - v_row.stage_started_at < make_interval(secs => v_stage_cfg.duration_seconds::int) then
        raise exception 'stage timer has not elapsed yet' using errcode = 'P0001';
    end if;

    if not p_condition_met then
        update public.user_retention_tasks urt
            set is_active = false,
                stage_started_at = null,
                last_verified_at = now(),
                updated_at = now()
            where urt.user_id = p_user_id and urt.task_type = p_task_type;

        return query
            select
                false, p_task_type, v_row.current_stage, false, null::timestamptz, false,
                0::numeric(18, 6), v_stage_cfg.reward_type,
                pr.game_balance, pr.withdrawable_balance, pr.withdrawal_quota
            from public.profiles pr
            where pr.id = p_user_id;
        return;
    end if;

    v_reward := v_stage_cfg.reward_amount;

    if v_stage_cfg.reward_type = 'game_balance' then
        update public.profiles as pr set game_balance = pr.game_balance + v_reward where pr.id = p_user_id;
    elsif v_stage_cfg.reward_type = 'ton' then
        update public.profiles as pr set withdrawable_balance = pr.withdrawable_balance + v_reward where pr.id = p_user_id;
    elsif v_stage_cfg.reward_type = 'quota' then
        update public.profiles as pr set withdrawal_quota = pr.withdrawal_quota + v_reward where pr.id = p_user_id;
    else
        raise exception 'unknown reward_type %', v_stage_cfg.reward_type;
    end if;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'retention_task_reward',
        v_reward,
        0,
        'completed',
        jsonb_build_object('task_type', p_task_type, 'stage', v_row.current_stage, 'reward_type', v_stage_cfg.reward_type)
    );

    if v_row.current_stage >= 6 then
        update public.user_retention_tasks urt
            set current_stage = 7,
                is_active = false,
                stage_started_at = null,
                last_verified_at = now(),
                total_reward_claimed = urt.total_reward_claimed + v_reward,
                updated_at = now()
            where urt.user_id = p_user_id and urt.task_type = p_task_type;

        return query
            select
                true, p_task_type, 7, false, null::timestamptz, true,
                v_reward, v_stage_cfg.reward_type,
                pr.game_balance, pr.withdrawable_balance, pr.withdrawal_quota
            from public.profiles pr
            where pr.id = p_user_id;
        return;
    end if;

    update public.user_retention_tasks urt
        set current_stage = v_row.current_stage + 1,
            is_active = true,
            stage_started_at = now(),
            last_verified_at = now(),
            total_reward_claimed = urt.total_reward_claimed + v_reward,
            updated_at = now()
        where urt.user_id = p_user_id and urt.task_type = p_task_type;

    return query
        select
            true, p_task_type, ur.current_stage, ur.is_active, ur.stage_started_at, false,
            v_reward, v_stage_cfg.reward_type,
            pr.game_balance, pr.withdrawable_balance, pr.withdrawal_quota
        from public.profiles pr, public.user_retention_tasks ur
        where pr.id = p_user_id and ur.user_id = p_user_id and ur.task_type = p_task_type;
end;
$$;

revoke all on function public.start_retention_task_stage(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.start_retention_task_stage(uuid, text, boolean) to service_role;
revoke all on function public.verify_retention_task_stage(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.verify_retention_task_stage(uuid, text, boolean) to service_role;
