-- Партнерське завдання SlayLands (@SlayLandsBot): дійти до хвилі 50.
--
-- action_type = 'partner_api_check': partner-ендпоінт приймає userId (=
-- telegram_id, підставляється через плейсхолдер {telegram_id}) і повертає
-- голе булеве тіло `true` / `false` (без обгортки {"success": ...}) —
-- checkExternalTask.ts обробляє таке тіло напряму, success_path не потрібен.
-- Авторизаційного заголовка немає. Невідомий userId -> 404 + `false`.
--
-- open_url містить src_feel — мітку джерела, за якою партнер рахує, звідки
-- приходять наші гравці.
--
-- Нагорода 0.003 / sort_order 50 — як у theiterra_enter / gram_generator_enter
-- (партнер власних значень не називав).
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values (
    'partners', 'slaylands_wave_50', '⚔️', 0.003, 'game_balance', 'partner_api_check',
    '{"open_url":"https://t.me/SlayLandsBot/play?startapp=src_feel","check_url":"https://slaylands.top/api/partner/check?userId={telegram_id}&field=maxWave&value=50"}',
    50
)
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
