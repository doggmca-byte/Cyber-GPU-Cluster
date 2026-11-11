-- Автозбір $HASH: profiles.auto_harvest (за замовчуванням false).
--
-- Для профілів із прапорцем крон /api/cron/auto-harvest раз на добу сам викликає
-- collect_hash — рівно той самий збір, що кнопка "Collect HASH" у застосунку, тож
-- людині не треба заходити взагалі. Прапорець окремий від unlimited_accrual
-- (20261111100000): безліміт знімає 8-годинну стелю накопичення, автозбір сам
-- зараховує. Разом вони дають "заходити не треба", а поодинці — не змішуються.
alter table public.profiles
    add column if not exists auto_harvest boolean not null default false;

-- Перша (і поки єдина) отримувачка: telegram_id 2072267275.
update public.profiles set auto_harvest = true where telegram_id = 2072267275;
