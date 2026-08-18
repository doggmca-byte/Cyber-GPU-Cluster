-- Той самий клас бага, що й у exchange_hash_to_ton (20260819100000_...sql):
-- RETURNS TABLE(.., revival_count integer, ..) неявно оголошує OUT-параметр
-- revival_count, який колізує з user_gpus.revival_count у
-- "SELECT ... revival_count INTO v_gpu" та в
-- "UPDATE ... SET revival_count = revival_count + 1" (обидва без аліасу) —
-- обидва впали б з "column reference \"revival_count\" is ambiguous" (42702)
-- при першому ж виклику revive_gpu. Виправлення: аліас ug + явна
-- квалфікація ug.revival_count скрізь.

create or replace function public.revive_gpu(p_user_id uuid, p_level integer)
returns table (
    new_game_balance    numeric(18, 6),
    revival_count        integer,
    revival_cost          numeric(18, 6)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_revival_multipliers constant numeric[] := array[0.75, 0.5, 0.25];
    v_template            public.gpu_templates%rowtype;
    v_gpu                 record;
    v_balance             numeric(18, 6);
    v_cost                numeric(18, 6);
begin
    if p_user_id is null or p_level is null then
        raise exception 'p_user_id and p_level are required';
    end if;

    select game_balance into v_balance
        from public.profiles
        where id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    select * into v_template from public.gpu_templates where level = p_level;
    if not found then
        raise exception 'gpu template level % not found', p_level using errcode = 'P0002';
    end if;

    select ug.id, ug.amount, ug.is_dead, ug.revival_count into v_gpu
        from public.user_gpus ug
        where ug.user_id = p_user_id
          and ug.gpu_level = p_level
        for update;

    if not found or not v_gpu.is_dead then
        raise exception 'gpu level % is not dead — nothing to revive', p_level
            using errcode = 'P0001';
    end if;

    if v_gpu.revival_count >= 3 then
        raise exception 'gpu level % has no revivals left', p_level using errcode = 'P0001';
    end if;

    v_cost := round(
        v_template.cost_ton * v_gpu.amount * v_revival_multipliers[v_gpu.revival_count + 1],
        6
    );

    if v_balance < v_cost then
        raise exception 'insufficient game_balance: has %, needs %', v_balance, v_cost
            using errcode = 'P0001';
    end if;

    update public.profiles
        set game_balance = game_balance - v_cost
        where id = p_user_id
        returning game_balance into v_balance;

    update public.user_gpus as ug
        set is_dead = false,
            lifetime_hash_generated = 0,
            last_harvest_at = clock_timestamp(),
            revival_count = ug.revival_count + 1
        where ug.id = v_gpu.id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (
        p_user_id, 'revive_gpu', -v_cost, 0, 'completed',
        jsonb_build_object('gpu_level', p_level, 'revival_count', v_gpu.revival_count + 1)
    );

    return query select v_balance, v_gpu.revival_count + 1, v_cost;
end;
$$;
