-- Штраф за відписку від Telegram-каналу/чату протягом 24 годин ПІСЛЯ
-- клейму нагороди за підписку (title_key subscribe_channel/subscribe_chat,
-- action_type='telegram_channel') — розмір штрафу = 2× реальної нагороди,
-- яку юзер отримав (не поточного task_templates.reward_amount, який міг
-- змінитись після клейму — беремо суму з transactions.task_reward, справжнє
-- джерело правди на момент нарахування).

alter table public.user_tasks
    add column if not exists channel_penalty_applied boolean not null default false;

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions
    add constraint transactions_type_check
    check (type = any (array[
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance', 'purchase_gpu',
        'referral_claim', 'referral_commission', 'task_reward', 'daily_bonus',
        'admin_grant', 'task_penalty'
    ]));

create or replace function public.apply_channel_unsubscribe_penalty(p_user_id uuid, p_task_id uuid)
returns table (
    penalty_amount   numeric(18, 6),
    game_balance     numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_user_task       record;
    v_original_reward numeric(18, 6);
    v_penalty         numeric(18, 6);
    v_current_balance numeric(18, 6);
    v_deducted        numeric(18, 6);
begin
    if p_user_id is null or p_task_id is null then
        raise exception 'p_user_id and p_task_id are required';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select ut.* into v_user_task
        from public.user_tasks ut
        where ut.user_id = p_user_id and ut.task_id = p_task_id
        for update;

    if not found then
        raise exception 'user_task not found' using errcode = 'P0002';
    end if;

    if v_user_task.status <> 'claimed' then
        raise exception 'task is not claimed, nothing to penalize' using errcode = 'P0001';
    end if;

    if v_user_task.channel_penalty_applied then
        raise exception 'penalty already applied' using errcode = 'P0001';
    end if;

    if v_user_task.claimed_at is null or v_user_task.claimed_at < now() - interval '24 hours' then
        raise exception '24h grace period already passed' using errcode = 'P0001';
    end if;

    -- Справжня нагорода, яку РЕАЛЬНО отримав юзер за цей таск (не поточний
    -- task_templates.reward_amount — той міг змінитись після клейму).
    select t.amount into v_original_reward
        from public.transactions t
        where t.user_id = p_user_id
          and t.type = 'task_reward'
          and t.payload->>'task_id' = p_task_id::text
        order by t.created_at desc
        limit 1;

    if v_original_reward is null then
        raise exception 'original reward transaction not found for task %', p_task_id using errcode = 'P0002';
    end if;

    v_penalty := v_original_reward * 2;

    select pr.game_balance into v_current_balance from public.profiles pr where pr.id = p_user_id;
    v_deducted := least(v_penalty, v_current_balance);

    update public.profiles as pr
        set game_balance = greatest(pr.game_balance - v_penalty, 0)
        where pr.id = p_user_id;

    update public.user_tasks
        set channel_penalty_applied = true,
            updated_at = now()
        where user_id = p_user_id and task_id = p_task_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id,
        'task_penalty',
        -v_deducted,
        0,
        'completed',
        jsonb_build_object(
            'task_id', p_task_id,
            'reason', 'channel_unsubscribed_within_24h',
            'original_reward', v_original_reward,
            'intended_penalty', v_penalty,
            'actual_deducted', v_deducted
        )
    );

    return query
        select v_penalty, pr.game_balance
        from public.profiles pr
        where pr.id = p_user_id;
end;
$$;

revoke all on function public.apply_channel_unsubscribe_penalty(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_channel_unsubscribe_penalty(uuid, uuid) to service_role;
