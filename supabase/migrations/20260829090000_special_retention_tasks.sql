-- "Особливі завдання із таймером утримання" (Special Retention Tasks):
-- NAME_TAG (додати тег боту в ім'я Telegram) і BIO_LINK (додати власне
-- реферальне посилання в Bio) — 6-етапний ланцюжок на кожен тип, з
-- ескалюючою нагородою й таймером утримання на кожному етапі (15хв -> 24г ->
-- 3д -> 7д -> 14д -> 30д). Умову (чи є тег/лінк в профілі ЗАРАЗ) неможливо
-- перевірити в SQL — це робить Next.js API-роут через Telegram Bot API
-- getChat ПЕРЕД викликом RPC нижче, той самий підхід, що й
-- enforceChannelUnsubscribePenalties/checkChannelMembershipStatus
-- (app/api/user/sync/route.ts, lib/telegram/getChatMember.ts): SQL лише
-- атомарно застосовує вже перевірений результат (p_condition_met), ніколи
-- не довіряє клієнту напряму.

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions
    add constraint transactions_type_check
    check (type = any (array[
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance', 'purchase_gpu',
        'referral_claim', 'referral_commission', 'task_reward', 'daily_bonus',
        'admin_grant', 'task_penalty', 'retention_task_reward'
    ]));

-- Конфіг етапів — окрема таблиця (не хардкод у RPC), щоб суми/тривалості
-- можна було тюнити однією міграцією без зміни логіки функцій, той самий
-- підхід, що й gpu_templates/task_templates.
create table public.retention_task_stage_config (
    task_type         text not null,
    stage             int not null,
    duration_seconds  bigint not null,
    reward_amount     numeric(18, 6) not null,
    reward_type       text not null default 'ton',
    constraint retention_task_stage_config_pk primary key (task_type, stage),
    constraint retention_task_stage_config_task_type_check check (task_type in ('NAME_TAG', 'BIO_LINK')),
    constraint retention_task_stage_config_stage_check check (stage between 1 and 6),
    constraint retention_task_stage_config_reward_type_check check (reward_type in ('game_balance', 'ton', 'quota')),
    constraint retention_task_stage_config_duration_check check (duration_seconds > 0),
    constraint retention_task_stage_config_reward_check check (reward_amount > 0)
);

alter table public.retention_task_stage_config enable row level security;

create policy retention_task_stage_config_select_all
    on public.retention_task_stage_config
    for select
    using (true);

-- Ескалююча шкала, ідентична для обох типів завдань (легко розвести пізніше
-- окремою міграцією, якщо знадобиться різна економіка на NAME_TAG/BIO_LINK).
-- Разом за повний ланцюжок одного типу: 0.001+0.003+0.008+0.02+0.05+0.15 =
-- 0.232 TON (масштаб звірено з WELCOME_BONUS_TON=0.25 і DAILY_BONUS=0.001 —
-- lib/constants/economy.ts).
insert into public.retention_task_stage_config (task_type, stage, duration_seconds, reward_amount, reward_type)
values
    ('NAME_TAG', 1, 900,     0.001, 'ton'),
    ('NAME_TAG', 2, 86400,   0.003, 'ton'),
    ('NAME_TAG', 3, 259200,  0.008, 'ton'),
    ('NAME_TAG', 4, 604800,  0.02,  'ton'),
    ('NAME_TAG', 5, 1209600, 0.05,  'ton'),
    ('NAME_TAG', 6, 2592000, 0.15,  'ton'),
    ('BIO_LINK', 1, 900,     0.001, 'ton'),
    ('BIO_LINK', 2, 86400,   0.003, 'ton'),
    ('BIO_LINK', 3, 259200,  0.008, 'ton'),
    ('BIO_LINK', 4, 604800,  0.02,  'ton'),
    ('BIO_LINK', 5, 1209600, 0.05,  'ton'),
    ('BIO_LINK', 6, 2592000, 0.15,  'ton');

-- Прогрес користувача — один рядок на (user_id, task_type). current_stage
-- 1..6 = поточний активний/очікуваний етап; 7 = увесь ланцюжок пройдено
-- (термінальний стан, is_active завжди false далі). Рядок з'являється лише
-- після першого "Старт" (upsert у start_retention_task_stage) — до того
-- клієнт бачить дефолтний стан "не розпочато", порахований у API-роуті.
create table public.user_retention_tasks (
    id                     uuid primary key default gen_random_uuid(),
    user_id                uuid not null references public.profiles(id) on delete cascade,
    task_type              text not null check (task_type in ('NAME_TAG', 'BIO_LINK')),
    current_stage          int not null default 1 check (current_stage between 1 and 7),
    stage_started_at       timestamptz,
    is_active              boolean not null default false,
    last_verified_at       timestamptz,
    total_reward_claimed   numeric(18, 6) not null default 0,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint user_retention_tasks_user_task_uq unique (user_id, task_type)
);

create index user_retention_tasks_user_id_idx on public.user_retention_tasks(user_id);

alter table public.user_retention_tasks enable row level security;
-- Жодних policy — доступ лише через service_role (admin-клієнт), той самий
-- підхід, що й user_tasks/user_gpus/profiles.

-- Старт (або рестарт) поточного етапу: вимагає, щоб умова (p_condition_met,
-- перевірена ДО виклику через Telegram Bot API) вже виконувалась ЗАРАЗ —
-- не можна почати відлік, не додавши тег/лінк.
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

    select * into v_row
        from public.user_retention_tasks
        where user_id = p_user_id and task_type = p_task_type
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

    select * into v_stage_cfg
        from public.retention_task_stage_config
        where task_type = p_task_type and stage = v_row.current_stage;

    if not found then
        raise exception 'stage config missing for % stage %', p_task_type, v_row.current_stage using errcode = 'P0002';
    end if;

    update public.user_retention_tasks
        set is_active = true,
            stage_started_at = now(),
            last_verified_at = now(),
            updated_at = now()
        where user_id = p_user_id and task_type = p_task_type;

    return query
        select ur.task_type, ur.current_stage, ur.is_active, ur.stage_started_at, v_stage_cfg.duration_seconds::int
        from public.user_retention_tasks ur
        where ur.user_id = p_user_id and ur.task_type = p_task_type;
end;
$$;

revoke all on function public.start_retention_task_stage(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.start_retention_task_stage(uuid, text, boolean) to service_role;

-- Перевірка активного етапу після спливання таймера:
--  * якщо умова більше не виконується (p_condition_met = false) — таймер
--    ПОТОЧНОГО етапу скидається (is_active=false, stage_started_at=null),
--    прогрес (current_stage) НЕ втрачається, користувач повертає умову й
--    тисне "Старт" знову; функція повертає success=false, БЕЗ винятку
--    (це нормальний, очікуваний результат флоу, не помилка стану).
--  * якщо умова виконується — нараховується нагорода поточного етапу,
--    вставляється transactions-рядок, і НАСТУПНИЙ етап стартує одразу
--    (умова щойно підтверджена цим самим викликом, тож немає сенсу
--    вимагати ще один ручний "Старт"). Останній (6-й) етап переводить
--    current_stage у термінальний 7 замість автостарту.
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

    select * into v_row
        from public.user_retention_tasks
        where user_id = p_user_id and task_type = p_task_type
        for update;

    if not found or not v_row.is_active then
        raise exception 'task stage is not active' using errcode = 'P0001';
    end if;

    select * into v_stage_cfg
        from public.retention_task_stage_config
        where task_type = p_task_type and stage = v_row.current_stage;

    if not found then
        raise exception 'stage config missing for % stage %', p_task_type, v_row.current_stage using errcode = 'P0002';
    end if;

    if now() - v_row.stage_started_at < make_interval(secs => v_stage_cfg.duration_seconds::int) then
        raise exception 'stage timer has not elapsed yet' using errcode = 'P0001';
    end if;

    if not p_condition_met then
        update public.user_retention_tasks
            set is_active = false,
                stage_started_at = null,
                last_verified_at = now(),
                updated_at = now()
            where user_id = p_user_id and task_type = p_task_type;

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
        update public.user_retention_tasks
            set current_stage = 7,
                is_active = false,
                stage_started_at = null,
                last_verified_at = now(),
                total_reward_claimed = total_reward_claimed + v_reward,
                updated_at = now()
            where user_id = p_user_id and task_type = p_task_type;

        return query
            select
                true, p_task_type, 7, false, null::timestamptz, true,
                v_reward, v_stage_cfg.reward_type,
                pr.game_balance, pr.withdrawable_balance, pr.withdrawal_quota
            from public.profiles pr
            where pr.id = p_user_id;
        return;
    end if;

    update public.user_retention_tasks
        set current_stage = v_row.current_stage + 1,
            is_active = true,
            stage_started_at = now(),
            last_verified_at = now(),
            total_reward_claimed = total_reward_claimed + v_reward,
            updated_at = now()
        where user_id = p_user_id and task_type = p_task_type;

    return query
        select
            true, p_task_type, ur.current_stage, ur.is_active, ur.stage_started_at, false,
            v_reward, v_stage_cfg.reward_type,
            pr.game_balance, pr.withdrawable_balance, pr.withdrawal_quota
        from public.profiles pr, public.user_retention_tasks ur
        where pr.id = p_user_id and ur.user_id = p_user_id and ur.task_type = p_task_type;
end;
$$;

revoke all on function public.verify_retention_task_stage(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.verify_retention_task_stage(uuid, text, boolean) to service_role;
