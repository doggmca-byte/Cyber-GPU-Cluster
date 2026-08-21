-- =====================================================================================
-- Pull/API-check модель для партнерських завдань (на відміну від push/postback з
-- 20260821110000_partner_task_postback.sql) — саме такий формат використовує реальна
-- мережа партнерів (приклад: Cookie Wars "api таски"):
--
--   GET {POSTBACK_URL}?id=<slug>&telegram_id=<user_id> -> {"success": true|false}
--
-- Жодного click_id/секрету — обидва застосунки Telegram Mini App, тож telegram_id
-- сам по собі вже universal identifier між ними. Партнер сам стукає СИНХРОННО, коли
-- хоче перевірити виконання (на відміну від нашого push-варіанту, де МИ стукаємо їм).
-- =====================================================================================

-- partner_check_definitions: публічний slug (той самий "id" з URL) -> яку з уже
-- наявних умов Task Center перевірити. Жодної нової логіки умов — той самий набір
-- action_type, що вже рахує claim_task_reward для НАШИХ власних завдань.
create table public.partner_check_definitions (
    id            uuid primary key default gen_random_uuid(),
    slug          text not null unique,
    action_type   text not null check (action_type in (
                      'own_gpus_count', 'own_gpu_level', 'harvest_count',
                      'harvest_total_hash', 'deposit_count', 'deposit_total_ton', 'invite_count'
                  )),
    target_value  text not null,
    is_active     boolean not null default true,
    created_at    timestamptz not null default now()
);

alter table public.partner_check_definitions enable row level security;
-- Без policy — лише service_role (як partner_integrations/partner_task_clicks),
-- сам роут все одно ходить через createAdminClient().

-- ------------------------------------------------------------------------------------
-- evaluate_partner_check_condition — read-only, БЕЗ побічних ефектів (на відміну від
-- claim_task_reward — тут нічого не нараховується, лише перевіряється факт).
-- Той самий набір гілок, що claim_task_reward/computeLiveProgress (app/api/tasks/
-- route.ts) — свідомо продубльовано (той самий підхід, що й в решті проєкту:
-- harvest_user_hash копіювався між міграціями замість спільної функції), щоб зміна
-- цього read-only чек-API ніколи не могла випадково зачепити реальне нарахування.
-- Невідомий telegram_id -> false (не помилка) — партнер міг стукнути ДО того, як
-- юзер взагалі відкрив наш застосунок і отримав профіль.
-- ------------------------------------------------------------------------------------
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

revoke all on function public.evaluate_partner_check_condition(bigint, text, text) from public, anon, authenticated;
grant execute on function public.evaluate_partner_check_condition(bigint, text, text) to service_role;

-- Seed: два приклади, вже надіслані партнеру в тексті ("Первый майнер" / "Raspberry
-- Neural Core") — щоб їхній перший тестовий виклик реально відповів, а не 404.
insert into public.partner_check_definitions (slug, action_type, target_value)
values
    ('cgc-own-gpu-any',  'own_gpus_count', '1'),
    ('cgc-own-gpu-lvl1', 'own_gpu_level',  '1')
on conflict (slug) do update
    set action_type  = excluded.action_type,
        target_value = excluded.target_value;
