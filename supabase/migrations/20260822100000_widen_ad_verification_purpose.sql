-- Розширюємо ad_verification_attempts.purpose з єдиного 'partner_ad_watch' на
-- всі три rewarded-ad flows застосунку: партнерська реклама (Партнери),
-- реклама для щоденного бонусу (DailyBonusModal) і реклама для квоти виводу
-- (WatchAdButton) — Monetag-постбек тепер реально підтверджує перегляд для
-- ВСІХ трьох, а не лише для одного.
alter table public.ad_verification_attempts drop constraint ad_verification_attempts_purpose_check;
alter table public.ad_verification_attempts
    add constraint ad_verification_attempts_purpose_check
    check (purpose in ('partner_ad_watch', 'daily_bonus_watch', 'withdraw_ad_watch'));
