-- Slug для partner-check API: "зробити 1 клейм" = хоча б один результативний збір HASH
-- (кнопка "Collect HASH", /api/farm/harvest) -> profiles.harvest_count >= 1.
-- Стартовий L1 видається автоматично при реєстрації, тож own_gpus_count/own_gpu_level
-- цього не відрізняють від cgc-app-open.
insert into public.partner_check_definitions (slug, action_type, target_value)
values ('cgc-first-claim', 'harvest_count', '1')
on conflict (slug) do update
    set action_type  = excluded.action_type,
        target_value = excluded.target_value;
