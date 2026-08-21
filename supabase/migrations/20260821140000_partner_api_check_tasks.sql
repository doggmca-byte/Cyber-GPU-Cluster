-- =====================================================================================
-- Реальні партнерські завдання (одностороннє: наш юзер -> їхній застосунок),
-- pull/API-check модель — action_type 'partner_api_check'. target_value —
-- JSON {open_url, check_url} (lib/partners/checkExternalTask.ts), перевірка йде
-- через /api/tasks/verify (той самий потік "Виконати" -> "Перевірити", що й
-- telegram_channel/external_link — жодної нової гілки в claim_task_reward не
-- треба, user_tasks.status уже 'completed' достатньо).
-- =====================================================================================

alter table public.task_templates
    drop constraint task_templates_action_type_check;

alter table public.task_templates
    add constraint task_templates_action_type_check
    check (action_type in (
        'telegram_channel', 'external_link', 'own_gpus_count',
        'harvest_count', 'invite_count', 'deposit_count', 'deposit_total_ton',
        'harvest_total_hash', 'own_gpu_level', 'partner_postback', 'partner_api_check'
    ));

insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order)
values
    (
        'partners',
        'cookie_wars_game_enter',
        'handshake',
        0.003,
        'game_balance',
        'partner_api_check',
        '{"open_url":"https://t.me/cookiewrs_bot/?startapp=ref_1675ed94","check_url":"https://api.cookiewrs.com/api/tasks/check?id=f1l1mon41k-s-ego-apki&telegram_id="}',
        10
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
