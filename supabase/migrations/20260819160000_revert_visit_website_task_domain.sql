-- =====================================================================================
-- Відкат 20260819140000_update_visit_website_task_domain.sql: cgpu-cluster.vercel.app
-- виявився вже зайнятим стороннім Vercel-проєктом (не належить нам — `vercel alias set`
-- відповів "already in use", `vercel domains add` відповів "invalid_domain", а сам домен
-- НЕ віддає код цього застосунку). Продакшн-домен лишається
-- https://cyber-gpu-cluster.vercel.app.
-- =====================================================================================
update public.task_templates
    set target_value = 'https://cyber-gpu-cluster.vercel.app'
    where title_key = 'visit_website'
      and target_value = 'https://cgpu-cluster.vercel.app';
