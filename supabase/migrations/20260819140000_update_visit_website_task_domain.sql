-- =====================================================================================
-- Продакшн-домен змінено на https://cgpu-cluster.vercel.app (був
-- https://cyber-gpu-cluster.vercel.app) — оновлюємо лише РЯДОК ДАНИХ у
-- task_templates (seed з 20260817140000_task_center.sql), саму історичну
-- міграцію не редагуємо (той самий підхід, що й до цього — фікси йдуть
-- новими міграціями, а не правками старих).
-- =====================================================================================
update public.task_templates
    set target_value = 'https://cgpu-cluster.vercel.app'
    where title_key = 'visit_website'
      and target_value = 'https://cyber-gpu-cluster.vercel.app';
