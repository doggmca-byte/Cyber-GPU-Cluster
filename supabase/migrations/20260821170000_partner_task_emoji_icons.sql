-- Різні, "прикольні" емодзі-іконки для кожного партнерського завдання замість
-- однакового 'handshake' для всіх трьох (components/tasks/TasksScreen.tsx
-- тепер рендерить task_templates.icon як емодзі-текст, якщо значення не є
-- ключем ICON_MAP).
update public.task_templates set icon = '🍪' where title_key = 'cookie_wars_game_enter';
update public.task_templates set icon = '⚔️' where title_key = 'crybble_game_enter';
update public.task_templates set icon = '🎯' where title_key = 'cookie_hunters_signup';
