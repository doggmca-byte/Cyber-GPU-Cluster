-- Готуємо ad_verification_attempts до другого postback-провайдера (AdsGram,
-- крім уже наявного Monetag) — додаємо provider, щоб різнити джерело в
-- аудиті/дедуплікації, а не лише за purpose (який завжди 'partner_ad_watch').
alter table public.ad_verification_attempts
    add column provider text not null default 'monetag' check (provider in ('monetag', 'adsgram'));
