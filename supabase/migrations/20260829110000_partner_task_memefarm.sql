-- Сьомий партнер: Meme Farm — pull/API-check, метрика "registered" (юзер
-- хоч раз відкрив їхній Mini App). check_url з плейсхолдером "{telegram_id}"
-- (той самий механізм, що додано для StarNex), success_path="result" —
-- буквальне булеве значення (той самий строгий "=== true" фікс з StarNex
-- теж застосовується тут).
--
-- is_active = false НАВМИСНО: за проханням активувати не одразу, а через
-- ~5 годин після додавання — окремий крок (не ця міграція) виставить
-- is_active=true пізніше.
insert into public.task_templates
    (category, title_key, icon, reward_amount, reward_type, action_type, target_value, sort_order, is_active)
values
    (
        'partners',
        'memefarm_open',
        '🐸',
        0.003,
        'game_balance',
        'partner_api_check',
        '{"open_url":"https://t.me/MeM_FARMbot?startapp","check_url":"https://nimwavhsurvzpfurequa.supabase.co/functions/v1/partner-check?telegram_id={telegram_id}&metric=registered","header_name":"X-Partner-Key","header_env_key":"MEMEFARM_PARTNER_KEY","success_path":"result"}',
        70,
        false
    )
on conflict (title_key) do update
    set category      = excluded.category,
        icon           = excluded.icon,
        reward_amount  = excluded.reward_amount,
        reward_type    = excluded.reward_type,
        action_type    = excluded.action_type,
        target_value   = excluded.target_value,
        sort_order     = excluded.sort_order;
