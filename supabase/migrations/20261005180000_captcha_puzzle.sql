-- =====================================================================================
-- Пазл-капча проти ботів/твінків.
--
-- profiles.captcha_verified_at — коли гравець востаннє пройшов пазл. Клієнт показує
-- капчу при вході, якщо пройшло > 24 год, а /api/wallet/withdraw ВІДМОВЛЯЄ без свіжої
-- верифікації (на сервері, не лише в UI).
--
-- captcha_challenges — одноразові виклики. Правильна відповідь (answer_x) живе ТІЛЬКИ
-- тут і ніколи не йде в браузер. Будь-яка спроба верифікації "спалює" виклик (used),
-- тож підбір відповіді перебором неможливий: одна спроба на один виклик.
-- Доступ лише через service role (RLS увімкнено, політик немає).
-- =====================================================================================

alter table public.profiles
    add column if not exists captcha_verified_at timestamptz;

create table if not exists public.captcha_challenges (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles(id) on delete cascade,
    answer_x    integer not null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used        boolean not null default false,
    solved      boolean not null default false
);

create index if not exists captcha_challenges_user_created_idx
    on public.captcha_challenges (user_id, created_at desc);

alter table public.captcha_challenges enable row level security;
