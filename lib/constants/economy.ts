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
export const HASH_EXCHANGE_WITHDRAWABLE_FEE_BPS = 200; // 2.00%, лише при виводі в withdrawable

// convert_withdrawable_to_game
export const MIN_CONVERT_BACK_TON = 0.1;

// request_withdrawal
export const WITHDRAW_FEE_BPS = 1000; // 10.00%
export const MIN_ADS_BEFORE_WITHDRAW = 20;
export const DAILY_WITHDRAWAL_LIMIT_TON = 100;

// record_ad_watch
export const AD_QUOTA_BONUS_TON = 0.05;

// process_successful_deposit
export const DEPOSIT_QUOTA_BONUS_RATE = 1.5; // +150% від суми депозиту
export const REFERRAL_DEPOSIT_REVSHARE_RATE = 0.05; // 5%, назавжди з кожного депозиту referee

// harvest_user_hash (реферальний бонус за перший видобуток)
export const REFERRAL_FIRST_HARVEST_BONUS_TON = 0.01;
export const REFERRAL_FIRST_HARVEST_THRESHOLD_HASH = 100;

export function calcFee(amount: number, feeBps: number): number {
  return Math.round(amount * feeBps) / 10000;
}
