-- =====================================================================================
-- Юбилейна акція "1 місяць Cyber GPU Cluster": -15% на ВСІ модулі, 7 діб.
--
-- Конфіг живе в promo_campaigns (а не в TS-константі): єдине джерело правди за
-- часом — now() бази. buy_gpu вже читає active_promo() тим самим now() і
-- рахує v_price = round(cost_ton * (100 - discount) / 100, 6), клієнт ціну не
-- передає. Після ends_at та сама покупка автоматично коштує повну ціну — без
-- деплою й правок у БД. Нову RPC/функцію створювати не треба.
--
--   старт   2026-09-21 00:00:00 UTC
--   кінець  2026-09-28 00:00:00 UTC   (start + 7 діб = 168 годин; діє now() < ends_at)
--   рівні   усі, що є в gpu_templates (L1 … L10)
--
-- Ідемпотентно: повторний запуск нічого не змінює (slug унікальний).
-- =====================================================================================
insert into public.promo_campaigns (slug, discount_percent, target_levels, starts_at, ends_at, is_active)
select
    'anniversary_1_month',
    15,
    array_agg(gt.level order by gt.level),
    timestamptz '2026-09-21 00:00:00+00',
    timestamptz '2026-09-21 00:00:00+00' + interval '7 days',
    true
from public.gpu_templates gt
on conflict (slug) do nothing;
