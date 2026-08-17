-- =====================================================================================
-- Центр Завдань (Task Center / Quests Hub)
--
-- Схема свідомо НЕ використовує нативні Postgres ENUM-типи для category/reward_type/
-- action_type/status (хоча в ТЗ вони позначені як ENUM) — увесь проєкт до цього
-- послідовно кодує подібні перелічення як `text` + `check (... in (...))`
-- (див. transactions.type/status, referrals). Причина: додавання нового значення
-- до text-check — це один ALTER CONSTRAINT у звичайній транзакційній міграції,
-- тоді як ALTER TYPE ... ADD VALUE у Postgres не можна виконати всередині
-- транзакції разом з іншими змінами. Поведінково для застосунку різниці немає.
--
-- title_key зберігає лише СЛАГ (напр. 'own_gpus_5'), а не повний шлях
-- 'tasks.items.own_gpus_5.title' — фронтенд сам будує обидва рядки (title/description)
-- з lib/i18n/dictionaries/*.ts за цим слагом (t.tasks.items[title_key]).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) task_templates — каталог завдань (редагується адміном/service_role напряму
--    в Supabase, як і gpu_templates).
-- ------------------------------------------------------------------------------------
create table if not exists public.task_templates (
    id              uuid primary key default gen_random_uuid(),
    category        text not null check (category in (
                        'in_game', 'general', 'partners', 'wallet', 'friends', 'special'
                    )),
    title_key       text not null,
    icon            text,
    reward_amount   numeric(18, 6) not null check (reward_amount > 0),
    reward_type     text not null check (reward_type in ('game_balance', 'ton', 'quota')),
    action_type     text not null check (action_type in (
                        'telegram_channel', 'external_link', 'own_gpus_count',
                        'harvest_count', 'invite_count', 'deposit_count'
                    )),
    -- INT чи TEXT залежно від action_type: поріг ('5') для *_count,
    -- @channel_username для telegram_channel, URL для external_link.
    target_value    text not null,
    sort_order      integer not null default 0,
    is_active       boolean not null default true,
    created_at      timestamptz not null default now(),

    -- унікальність за слагом — і як бізнес-ключ (один слаг = один запис
    -- перекладу), і щоб SEED нижче міг бути ідемпотентним через ON CONFLICT
    -- (id — випадковий uuid, сам по собі ні на що не конфліктує)
    constraint task_templates_title_key_uq unique (title_key)
);

create index if not exists idx_task_templates_active_category
    on public.task_templates (category, sort_order)
    where is_active;

-- ------------------------------------------------------------------------------------
-- 2) user_tasks — прогрес користувача по кожному завданню.
-- ------------------------------------------------------------------------------------
create table if not exists public.user_tasks (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.profiles (id) on delete cascade,
    task_id      uuid not null references public.task_templates (id) on delete cascade,
    status       text not null default 'pending' check (status in ('pending', 'completed', 'claimed')),
    claimed_at   timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    constraint user_tasks_user_task_uq unique (user_id, task_id)
);

create index if not exists idx_user_tasks_user_id on public.user_tasks (user_id);

alter table public.task_templates enable row level security;
alter table public.user_tasks     enable row level security;

-- каталог завдань можна читати всім (як gpu_templates) — самі баланси все одно
-- захищені RPC нижче, а user_tasks доступний лише через service_role бекенд.
create policy task_templates_select_all
    on public.task_templates
    for select
    using (true);

-- ------------------------------------------------------------------------------------
-- 3) profiles.harvest_count — лічильник кількості УСПІШНИХ (total_harvested > 0)
--    викликів harvest_user_hash. Потрібен виключно для завдань action_type =
--    'harvest_count' (у профілю раніше не було жодного лічильника подій, лише
--    накопичені суми) — own_gpus_count/invite_count/deposit_count рахуються
--    "наживо" прямими запитами до user_gpus/referrals/transactions і окремого
--    лічильника не потребують.
-- ------------------------------------------------------------------------------------
alter table public.profiles
    add column harvest_count integer not null default 0
        check (harvest_count >= 0);

-- ------------------------------------------------------------------------------------
-- 4) transactions.type: додаємо 'task_reward'
-- ------------------------------------------------------------------------------------
alter table public.transactions
    drop constraint transactions_type_check;

alter table public.transactions
    add constraint transactions_type_check
    check (type in (
        'deposit', 'withdraw', 'exchange_hash', 'convert_balance',
        'purchase_gpu', 'referral_claim', 'referral_commission', 'task_reward'
    ));

-- ------------------------------------------------------------------------------------
-- 5) harvest_user_hash: той самий алгоритм, що й у
--    20260816220519_deposit_revshare_and_withdraw_address.sql, плюс +1 до
--    harvest_count при кожному РЕЗУЛЬТАТИВНОМУ зборі (total_harvested > 0).
-- ------------------------------------------------------------------------------------
create or replace function public.harvest_user_hash(p_user_id uuid)
returns numeric(18, 6)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now                    timestamptz := clock_timestamp();
    v_total_harvested        numeric(18, 6) := 0;
    v_elapsed_seconds         numeric;
    v_row_harvested            numeric(18, 6);
    v_gpu                      record;
    v_referrer_id              uuid;
    v_lifetime_hash            numeric(18, 6);
    -- TODO: продуктові константи-заглушки, узгодити фінальні цифри окремо
    v_first_harvest_bonus     constant numeric(18, 6) := 0.01;
    v_threshold_hash           constant numeric(18, 6) := 100;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    -- 1) лочимо referee (викликача) першим — той самий порядок, що й
    -- у process_successful_deposit, щоб уникнути deadlock
    select pr.referrer_id into v_referrer_id
        from public.profiles pr
        where pr.id = p_user_id
        for update;

    if not found then
        raise exception 'profile % not found', p_user_id using errcode = 'P0002';
    end if;

    for v_gpu in
        select ug.id, ug.amount, ug.last_harvest_at, gt.hash_per_second
        from public.user_gpus ug
        join public.gpu_templates gt on gt.level = ug.gpu_level
        where ug.user_id = p_user_id
          and ug.amount > 0
        order by ug.id
        for update of ug
    loop
        v_elapsed_seconds := greatest(extract(epoch from (v_now - v_gpu.last_harvest_at)), 0);
        v_row_harvested := round(v_elapsed_seconds * v_gpu.hash_per_second * v_gpu.amount, 6);
        v_total_harvested := v_total_harvested + v_row_harvested;

        update public.user_gpus
            set last_harvest_at = v_now
            where id = v_gpu.id;
    end loop;

    if v_total_harvested > 0 then
        update public.profiles as pr
            set hash_balance = pr.hash_balance + v_total_harvested,
                lifetime_hash_generated = pr.lifetime_hash_generated + v_total_harvested,
                harvest_count = pr.harvest_count + 1
            where pr.id = p_user_id
            returning pr.lifetime_hash_generated into v_lifetime_hash;

        if v_referrer_id is not null and v_lifetime_hash >= v_threshold_hash then
            -- 2) лочимо referrer ДРУГИМ
            perform 1 from public.profiles where id = v_referrer_id for update;

            -- 3) і лише тепер рядок referrals — атомарно перевіряємо й одразу
            -- перемикаємо прапорець, щоб виключити подвійне нарахування при
            -- паралельних harvest-викликах цього ж referee
            update public.referrals
                set has_reached_threshold = true,
                    pending_reward = pending_reward + v_first_harvest_bonus,
                    total_earned = total_earned + v_first_harvest_bonus
                where referrer_id = v_referrer_id
                  and referee_id = p_user_id
                  and has_reached_threshold = false;

            if found then
                insert into public.transactions (user_id, type, amount, fee, status, payload)
                values (
                    v_referrer_id,
                    'referral_commission',
                    v_first_harvest_bonus,
                    0,
                    'completed',
                    jsonb_build_object('source', 'harvest_threshold', 'referee_id', p_user_id)
                );
            end if;
        end if;
    end if;

    return v_total_harvested;
end;
$$;

-- ------------------------------------------------------------------------------------
-- 6) claim_task_reward(p_user_id, p_task_id)
--    Блокує profiles (стабільний персональний м'ютекс, той самий порядок, що й
--    решта RPC) і рядок task_templates/user_tasks. Якщо user_tasks.status ще не
--    'completed' — для *_count завдань валідує умову НАЖИВО за живими даними
--    (без потреби у verify-кроці), для telegram_channel/external_link вимагає,
--    щоб /api/tasks/verify вже виставив 'completed' (тут ми ці два типи самі не
--    перевіряємо — Bot API виклик належить лише роуту).
-- ------------------------------------------------------------------------------------
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

    -- персональний м'ютекс — той самий порядок блокувань, що й в усіх інших RPC
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

    -- гарантуємо існування рядка user_tasks і одразу блокуємо його.
    -- ON CONFLICT ON CONSTRAINT (а не ON CONFLICT (user_id, task_id)) навмисно —
    -- список колонок у дужках тут резолвиться як звичайний вираз і "task_id"
    -- виявляється неоднозначним між OUT-параметром claim_task_reward і колонкою
    -- таблиці (спіймано живим тестом: ERROR 42702 ambiguous column reference).
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
                -- telegram_channel / external_link: довіряємо ЛИШЕ статусу,
                -- виставленому /api/tasks/verify (реальний виклик Bot API
                -- getChatMember живе там, а не тут)
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

revoke all on function public.claim_task_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_task_reward(uuid, uuid) to service_role;

-- harvest_user_hash грант не змінився (лишається як в core-міграції), але
-- CREATE OR REPLACE не скидає раніше видані GRANT — повторний revoke/grant тут
-- не потрібен.

-- ------------------------------------------------------------------------------------
-- 7) SEED: приклади завдань по всіх 6 категоріях.
--
-- TODO продакшн-налаштування ПЕРЕД запуском реальних юзерів:
--   - subscribe_channel / partner_channel: target_value зараз плейсхолдер
--     '@your_channel_here' / '@partner_channel_here' — замінити на реальний
--     @username каналу (бот має бути адміном каналу, інакше getChatMember
--     поверне ok:false і завдання ніколи не підтвердиться).
--   - partner_offer / special_promo: target_value зараз example.com-плейсхолдер —
--     замінити на реальне посилання партнера/акції.
--   - visit_website вказує на реальний продакшн-домен застосунку.
-- ------------------------------------------------------------------------------------
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    -- in_game
    ('in_game', 'own_gpus_5',  'cpu', 0.10, 'game_balance', 'own_gpus_count', '5',  10),
    ('in_game', 'own_gpus_20', 'cpu', 0.50, 'game_balance', 'own_gpus_count', '20', 20),
    ('in_game', 'harvest_10',  'zap', 0.05, 'game_balance', 'harvest_count',  '10', 30),
    ('in_game', 'harvest_50',  'zap', 0.25, 'game_balance', 'harvest_count',  '50', 40),

    -- general
    ('general', 'subscribe_channel', 'send', 0.02, 'ton',   'telegram_channel', '@your_channel_here', 10),
    ('general', 'visit_website',     'link', 0.05, 'quota', 'external_link',    'https://cyber-gpu-cluster.vercel.app', 20),

    -- partners
    ('partners', 'partner_channel', 'handshake', 0.02, 'ton', 'telegram_channel', '@partner_channel_here', 10),
    ('partners', 'partner_offer',   'handshake', 0.03, 'ton', 'external_link',    'https://example.com/partner-offer', 20),

    -- wallet
    ('wallet', 'first_deposit', 'wallet', 0.05, 'ton', 'deposit_count', '1', 10),
    ('wallet', 'deposit_5',     'wallet', 0.20, 'ton', 'deposit_count', '5', 20),

    -- friends
    ('friends', 'invite_1',  'users', 0.10, 'quota', 'invite_count', '1',  10),
    ('friends', 'invite_5',  'users', 0.10, 'ton',   'invite_count', '5',  20),
    ('friends', 'invite_20', 'users', 0.50, 'ton',   'invite_count', '20', 30),

    -- special
    ('special', 'special_promo', 'star', 1.00, 'game_balance', 'external_link', 'https://example.com/special-promo', 10)
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
