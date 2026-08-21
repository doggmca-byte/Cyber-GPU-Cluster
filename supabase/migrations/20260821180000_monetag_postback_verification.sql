-- =====================================================================================
-- Server-side верифікація Monetag rewarded-реклами через їхній S2S postback
-- (https://docs.monetag.com/docs/postbacks/) — замінює довіру клієнтському SDK
-- ЛИШЕ для показів через Monetag; GigaPub-половина ротації (lib/ads/rewardedAd.ts)
-- лишається на довірі клієнту (за рішенням — GigaPub не має аналогічного postback).
--
-- Потік:
--   1) Клієнт просить attempt ПЕРЕД показом реклами (POST /api/ads/monetag/start-attempt)
--      -> pending-рядок, id рядка = ymid, який передається в show_11600101({ymid}).
--   2) Якщо ротація показала саме Monetag — чекаємо НЕ клієнтського success, а
--      реального postback від сервера Monetag (GET /api/ads/monetag-postback,
--      захищений статичним секретом у URL — сам ymid іде через клієнт, тож ЙОГО
--      самого недостатньо як секрету).
--   3) Заліковий record_partner_ad_watch викликається лише з постбек-роуту.
-- =====================================================================================

create table public.ad_verification_attempts (
    id                          uuid primary key default gen_random_uuid(),
    user_id                     uuid not null references public.profiles (id) on delete cascade,
    -- Наразі єдина реальна ціль — партнерська TON-нагорода за рекламу
    -- (record_partner_ad_watch). Інші flows (WatchAdButton-квота, daily bonus)
    -- лишаються повністю на клієнтській довірі, свідомо не мігровані цим рядком.
    purpose                     text not null check (purpose in ('partner_ad_watch')),
    status                      text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
    reported_telegram_id        bigint,
    reported_reward_event_type  text,
    created_at                  timestamptz not null default now(),
    confirmed_at                timestamptz
);

create index idx_ad_verification_attempts_user on public.ad_verification_attempts (user_id);

alter table public.ad_verification_attempts enable row level security;
-- Без policy — лише service_role, як і решта partner_*-таблиць.
