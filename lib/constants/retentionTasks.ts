/**
 * "Особливі завдання із таймером утримання" (Special Retention Tasks) —
 * джерело правди для сум/тривалостей лишається БД
 * (retention_task_stage_config, supabase/migrations/
 * 20260829090000_special_retention_tasks.sql); тут — лише клієнтський
 * фолбек/прев'ю ТА єдине місце, де визначено самі УМОВИ верифікації
 * (обов'язковий тег в імені, формат реферального лінка), той самий підхід,
 * що й lib/constants/economy.ts.
 */

export type RetentionTaskType = "NAME_TAG" | "BIO_LINK";

export const RETENTION_TASK_TYPES: readonly RetentionTaskType[] = ["NAME_TAG", "BIO_LINK"];

export const RETENTION_TOTAL_STAGES = 6;

/**
 * Точний рядок, який має міститись у first_name АБО last_name користувача в
 * Telegram (lib/retention/checkRetentionCondition.ts). Публічний бренд-тег
 * бота — НЕ секрет, тому спокійно живе в клієнтському бандлі (потрібен UI
 * для кнопки "Копіювати").
 */
export const RETENTION_NAME_TAG = "@CyberGPU_bot ⚡️";

/** Дзеркало DB-конфіга — лише для миттєвого UI-прев'ю до першого запиту. */
export const RETENTION_STAGE_DURATIONS_SECONDS: readonly number[] = [
  900, // 15 хв
  86400, // 24 год
  259200, // 3 дні
  604800, // 7 днів
  1209600, // 14 днів
  2592000, // 30 днів
];

export const RETENTION_STAGE_REWARDS_TON: readonly number[] = [0.001, 0.003, 0.008, 0.02, 0.05, 0.15];
