-- =====================================================================================
-- AdsGram Task: нагорода 0.001 -> 0.0005 TON і ліміт 8 виконань на годину.
--
-- 0.001 TON за завдання з'їдало 80-95% доходу від AdsGram (аудит 22.10: 371
-- оплачене завдання ~0.371 TON проти $0.62 у кабінеті). 0.0005 лишає приблизно
-- половину. Ліміт — ковзне вікно 60 хв за вже нарахованими task_reward цього
-- джерела; рядок профілю блокується FOR UPDATE, тож паралельні постбеки не
-- проскочать дев'ятим. Перевищення — P0001: роут адсграм-постбеку записує
-- спробу як rejected і не нараховує. TADS (інше джерело) не змінюється.
-- =====================================================================================
create or replace function public.record_sponsor_task_reward(p_user_id uuid, p_source text)
returns table (withdrawable_balance numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_adsgram_task_reward   constant numeric(18, 6) := 0.0005;
    v_default_reward        constant numeric(18, 6) := 0.001;
    v_adsgram_hourly_limit  constant integer := 8;
    v_reward_amount         numeric(18, 6);
    v_done_last_hour        integer;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    perform 1 from public.profiles pr where pr.id = p_user_id for update;
    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    if p_source = 'adsgram_task' then
        select count(*) into v_done_last_hour
            from public.transactions t
            where t.user_id = p_user_id
              and t.type = 'task_reward'
              and t.payload ->> 'source' = 'adsgram_task'
              and t.created_at > now() - interval '1 hour';

        if v_done_last_hour >= v_adsgram_hourly_limit then
            raise exception 'adsgram task hourly limit reached (% per hour)', v_adsgram_hourly_limit
                using errcode = 'P0001';
        end if;

        v_reward_amount := v_adsgram_task_reward;
    else
        v_reward_amount := v_default_reward;
    end if;

    update public.profiles as pr
        set withdrawable_balance = pr.withdrawable_balance + v_reward_amount
        where pr.id = p_user_id;

    insert into public.transactions (user_id, type, amount, fee, status, payload)
    values (p_user_id, 'task_reward', v_reward_amount, 0, 'completed', jsonb_build_object('source', p_source));

    return query select pr.withdrawable_balance from public.profiles pr where pr.id = p_user_id;
end;
$$;

revoke all on function public.record_sponsor_task_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.record_sponsor_task_reward(uuid, text) to service_role;
