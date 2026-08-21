-- =====================================================================================
-- Партнерська S2S postback-інтеграція завдань (Task Center → "Партнери"):
--
--   outbound (наш юзер іде ДО партнера): /api/partners/click генерує click_id і
--   веде юзера на target_value партнера; коли партнер підтверджує виконання —
--   стукає нам POST /api/partners/postback з тим самим click_id, ми зараховуємо.
--
--   inbound (юзер партнера йде ДО нас) — поки лише схема під це готова
--   (partner_integrations.outbound_postback_url/outbound_secret), сам тригер
--   "коли наш юзер виконав ціль партнера" додасться окремою міграцією разом
--   із реальним партнером і конкретною подією-тригером.
--
-- Жодного нового RPC для нарахування не треба: 'partner_postback' — той самий
-- клас, що telegram_channel/external_link у claim_task_reward (v_user_task.status
-- вже 'completed' -> v_condition_met := true без окремої гілки в CASE) —
-- /api/partners/postback лише виставляє user_tasks.status = 'completed', так
-- само, як /api/tasks/verify для тих двох типів.
-- =====================================================================================

create table public.partner_integrations (
    id                     uuid primary key default gen_random_uuid(),
    slug                   text not null unique,
    display_name           text not null,
    -- Секрет, який ПАРТНЕР кладе у вхідний postback (напрямок партнер -> ми),
    -- щоб підтвердити, що запит справді від нього.
    inbound_secret         text not null,
    -- Куди МИ стукаємо, коли НАШ юзер виконав ціль партнера (напрямок ми -> партнер,
    -- поки не задіяно жодним роутом — готово на майбутнє).
    outbound_postback_url  text,
    outbound_secret        text,
    is_active              boolean not null default true,
    created_at             timestamptz not null default now()
);

alter table public.partner_integrations enable row level security;
-- Жодних policy на select/insert/update — доступ лише через service_role
-- (як і task_templates для запису, на відміну від його ж policy на читання).

-- task_templates.partner_id — прив'язка partner_postback-завдання до конкретного
-- партнера (nullable: інші action_type його не використовують).
alter table public.task_templates
    add column partner_id uuid references public.partner_integrations (id);

alter table public.task_templates
    drop constraint task_templates_action_type_check;

alter table public.task_templates
    add constraint task_templates_action_type_check
    check (action_type in (
        'telegram_channel', 'external_link', 'own_gpus_count',
        'harvest_count', 'invite_count', 'deposit_count', 'deposit_total_ton',
        'harvest_total_hash', 'own_gpu_level', 'partner_postback'
    ));

create table public.partner_task_clicks (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.profiles (id) on delete cascade,
    task_id       uuid not null references public.task_templates (id) on delete cascade,
    partner_id    uuid not null references public.partner_integrations (id) on delete cascade,
    click_id      text not null unique,
    direction     text not null check (direction in ('outbound', 'inbound')),
    status        text not null default 'pending' check (status in ('pending', 'confirmed')),
    created_at    timestamptz not null default now(),
    confirmed_at  timestamptz
);

create index idx_partner_task_clicks_user on public.partner_task_clicks (user_id);
create index idx_partner_task_clicks_click_id on public.partner_task_clicks (click_id);

alter table public.partner_task_clicks enable row level security;
