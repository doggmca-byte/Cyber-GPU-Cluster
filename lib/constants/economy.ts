/**
 * Економічні константи для UI-прев'ю (миттєвий розрахунок комісій/лімітів
 * без запиту до сервера). Джерело правди — SQL RPC у supabase/migrations/
 * (20260816210218_..., 20260816213917_wallet_referrals_ads_rpc.sql).
 * Тримати синхронізовано вручну; будь-яка розбіжність — баг у клієнтському
 * прев'ю, сервер завжди перевіряє й забезпечує коректність насправді.
 */

// exchange_hash_to_ton
export const HASH_TO_TON_RATE = 0.00001; // 100 000 HASH = 1 TON
export const MIN_HASH_EXCHANGE = 1000;
// Сума обміну має бути кратна цьому кроку (не лише >= MIN_HASH_EXCHANGE) —
// на практиці зараз крок дорівнює мінімуму, але це два незалежні правила
// на сервері (20260818130000_welcome_bonus_harvest_cap_exchange_step.sql),
// тримаємо окремою константою навмисно.
export const HASH_EXCHANGE_STEP = 1000;
export const HASH_EXCHANGE_WITHDRAWABLE_FEE_BPS = 200; // 2.00%, лише при виводі в withdrawable

// convert_withdrawable_to_game
export const MIN_CONVERT_BACK_TON = 0.1;

// request_withdrawal
// Тіньовані мінімум/максимум/комісія за номером ЦІЄЇ заявки
// (profiles.withdrawal_request_count ДО інкременту) — 0-ва заявка перша.
export const WITHDRAW_FEE_BPS = 1000; // 10.00%, з 3-ї заявки (index >= 2)
export const MIN_ADS_BEFORE_WITHDRAW = 20;
export const WITHDRAW_MIN_TIERS_TON = [0.1, 0.25, 0.5]; // [0-ва, 1-ша, 2-га+ (останнє значення)]
export const WITHDRAW_FLAT_FEE_TIERS_TON = [0.03, 0.05]; // [0-ва, 1-ша]; з 2-ї — WITHDRAW_FEE_BPS (%)
// Максимум за заявку залежить від lifetime_deposited_ton.
export const WITHDRAW_MAX_TIERS: ReadonlyArray<{ depositLessThan: number | null; maxTon: number }> = [
  { depositLessThan: 5, maxTon: 1 },
  { depositLessThan: 100, maxTon: 3 },
  { depositLessThan: 250, maxTon: 7 },
  { depositLessThan: null, maxTon: 15 }, // 250+
];

export function withdrawMinForRequest(requestCount: number): number {
  const tiers = WITHDRAW_MIN_TIERS_TON;
  return tiers[Math.min(requestCount, tiers.length - 1)];
}

export function withdrawMaxForDeposits(lifetimeDepositedTon: number): number {
  const tier = WITHDRAW_MAX_TIERS.find((t) => t.depositLessThan === null || lifetimeDepositedTon < t.depositLessThan);
  return tier ? tier.maxTon : WITHDRAW_MAX_TIERS[WITHDRAW_MAX_TIERS.length - 1].maxTon;
}

export function withdrawFeeForRequest(requestCount: number, amount: number): number {
  const flatTiers = WITHDRAW_FLAT_FEE_TIERS_TON;
  if (requestCount < flatTiers.length) return flatTiers[requestCount];
  return calcFee(amount, WITHDRAW_FEE_BPS);
}

// record_ad_watch
export const AD_QUOTA_BONUS_TON = 0.05;

// process_successful_deposit
export const DEPOSIT_QUOTA_BONUS_RATE = 1.5; // +150% від суми депозиту
export const REFERRAL_DEPOSIT_REVSHARE_RATE = 0.05; // 5%, назавжди з кожного депозиту referee

// harvest_user_hash (реферальний бонус за перший видобуток)
export const REFERRAL_FIRST_HARVEST_BONUS_TON = 0.01;
export const REFERRAL_FIRST_HARVEST_THRESHOLD_HASH = 100;

// claim_daily_bonus
export const DAILY_BONUS_REWARD_TON = 0.001;
// Мінімальна "взаємодія з рекламою" перед клеймом (Adsgram/Monetag-заглушка,
// той самий підхід, що й у record_ad_watch/WatchAdButton — реального SDK
// callback тут немає, сервер лише перевіряє, що клієнт відзвітував про
// виконання чеклиста, перш ніж викликати claim_daily_bonus).
export const DAILY_BONUS_MIN_AD_INTERACTIONS = 2;
export const DAILY_BONUS_MIN_AD_WATCH_SECONDS = 5;

// createProfileWithOptionalReferral (app/api/user/sync/route.ts вставляє
// профіль БЕЗ явного game_balance — бонус приходить із DEFAULT колонки в
// БД, тут лише для UI/довідки, змінювати саму суму — лише міграцією).
export const WELCOME_BONUS_TON = 0.25;

// harvest_user_hash: максимальний час без харвесту, за який ще нараховується
// $HASH — далі накопичення для картки "заморожується" (не пропадає весь
// прогрес, а просто перестає рости), доки гравець не забере зібране (це
// скидає лічильник картки на v_now). Той самий кап застосовує клієнтський
// прев'ю-розрахунок (hooks/useMiningEngine.ts, components/farm/FarmScreen.tsx),
// інакше великий лічильник показував би більше, ніж сервер реально нарахує.
export const MAX_UNCLAIMED_HOURS = 12;
export const MAX_UNCLAIMED_SECONDS = MAX_UNCLAIMED_HOURS * 3600;

// record_ad_watch / request_withdrawal: ads_watched_since_withdraw
// реінкарнується лінивим порівнянням ads_quota_reset_date з поточною UTC-датою
// щоразу, як лічильник читається/пишеться — не лише після виводу. Клієнту
// прапорець не потрібен (сервер завжди перевіряє актуальне значення), лишень
// для довідки тут.

// harvest_user_hash / revive_gpu: lifecycle-кап агрегатно по рядку
// (user, level) — cap_hash = cost_ton × GPU_LIFECYCLE_MULTIPLIER × amount /
// HASH_TO_TON_RATE. Коли lifetime_hash_generated досягає цього капа — рядок
// "мертвий" (is_dead), більше не нараховує, доки не оживлений.
export const GPU_LIFECYCLE_MULTIPLIER = 1.25;
export const GPU_REVIVAL_MAX_COUNT = 3;
// Ціна оживлення = cost_ton × amount × множник за НОМЕРОМ оживлення
// (0-індексація: revival_count ДО цього оживлення).
export const GPU_REVIVAL_COST_MULTIPLIERS = [0.75, 0.5, 0.25] as const;

export function gpuLifecycleCapHash(costTon: number, amount: number): number {
  return (costTon * GPU_LIFECYCLE_MULTIPLIER * amount) / HASH_TO_TON_RATE;
}

export function gpuRevivalCost(costTon: number, amount: number, revivalCount: number): number {
  const multiplier = GPU_REVIVAL_COST_MULTIPLIERS[revivalCount] ?? 0;
  return costTon * amount * multiplier;
}

export function calcFee(amount: number, feeBps: number): number {
  return Math.round(amount * feeBps) / 10000;
}
