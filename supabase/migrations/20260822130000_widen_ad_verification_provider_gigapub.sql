-- Готуємо ad_verification_attempts до третього postback-провайдера (GigaPub,
-- крім наявних Monetag/AdsGram) — support GigaPub повідомив про реальний
-- callback-механізм (не задокументований публічно, лише через їхню
-- підтримку): GET {postback_url}?uid={user_id}&event=ad_shown.
alter table public.ad_verification_attempts drop constraint ad_verification_attempts_provider_check;
alter table public.ad_verification_attempts
    add constraint ad_verification_attempts_provider_check
    check (provider in ('monetag', 'adsgram', 'gigapub'));
