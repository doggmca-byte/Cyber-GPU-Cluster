-- =====================================================================================
-- Ювілейна акція "2 місяці Cyber GPU Cluster": -15% на ВСІ модулі, 1 доба.
--
-- Та сама схема, що й 20260921120000_anniversary_promo.sql: конфіг у
-- promo_campaigns, buy_gpu читає active_promo() за now() бази і сам рахує
-- v_price = round(cost_ton * (100 - discount) / 100, 6). Після ends_at покупка
-- автоматично коштує повну ціну — без деплою й правок у БД.
--
--   старт   2026-10-20 00:00:00 UTC
--   кінець  2026-10-21 00:00:00 UTC   (start + 1 доба = 24 години; діє now() < ends_at)
--   рівні   усі, що є в gpu_templates
--
-- Ідемпотентно: повторний запуск нічого не змінює (slug унікальний).
-- =====================================================================================
insert into public.promo_campaigns (slug, discount_percent, target_levels, starts_at, ends_at, is_active)
select
    'anniversary_2_months',
    15,
    array_agg(gt.level order by gt.level),
    timestamptz '2026-10-20 00:00:00+00',
    timestamptz '2026-10-20 00:00:00+00' + interval '1 day',
    true
from public.gpu_templates gt
on conflict (slug) do nothing;
