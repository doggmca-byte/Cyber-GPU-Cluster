-- Вмикаємо завдання "Підпишись на канал виплат" після того, як @CyberGPU_bot
-- отримав права адміністратора в @CGPU_transactions.
--
-- Перевірено перед вмиканням: getChatMember на живих telegram_id повертає для
-- цього каналу "left" (тобто "не підписаний"), рівно як і для давно робочого
-- @CGPU_CL — механіка перевірки працює, а не мовчки падає в "unknown".
update public.task_templates
    set is_active = true
    where title_key = 'subscribe_payouts_channel';
