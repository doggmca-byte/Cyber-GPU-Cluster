-- Четвертий rewarded-провайдер поряд із monetag/adsgram/gigapub: tads.me
-- (Static/TGB widget, нагорода на клік з реальним S2S webhook-підтвердженням).
alter table public.ad_verification_attempts drop constraint ad_verification_attempts_provider_check;
alter table public.ad_verification_attempts
    add constraint ad_verification_attempts_provider_check
    check (provider = any (array['monetag', 'adsgram', 'gigapub', 'tads']));
