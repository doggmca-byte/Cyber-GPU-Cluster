/**
 * 'processing' = begin_withdrawal_payout уже "застовпив" заявку під авто-виплату
 * (гроші, можливо, вже пішли з казначейства), але approve_withdrawal чомусь не
 * завершив її — раніше такі рядки взагалі зникали з панелі (GET фільтрував лише
 * 'pending'), тепер видимі окремо й БЕЗ auto-approve/reject кнопок (обидві RPC
 * вимагають статус 'pending' — тут лишається тільки ручне введення хешу виплати).
 */
export type AdminWithdrawalStatus = "pending" | "processing";

export interface AdminWithdrawalItem {
  transaction_id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  requested_amount: number;
  fee: number;
  net_payout: number;
  destination_address: string;
  status: AdminWithdrawalStatus;
  created_at: string;
}

export interface AdminWithdrawalsListResponse {
  items: AdminWithdrawalItem[];
}

export interface AdminApproveResponse {
  transaction_id: string;
  status: string;
  tx_hash: string | null;
}

export interface AdminRejectResponse {
  transaction_id: string;
  status: string;
  refunded_amount: number;
  withdrawable_balance: number;
  withdrawal_quota: number;
}

export interface AdminTreasuryResponse {
  balance_ton: number;
}

/** Вкладка "Амбасадори" — пошук/призначення за telegram_id + таблиця вже призначених. */
export interface AdminAmbassadorProfile {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  is_ambassador: boolean;
}

export interface AdminAmbassadorsListResponse {
  items: AdminAmbassadorProfile[];
}

export interface AdminAmbassadorToggleResponse {
  profile: AdminAmbassadorProfile;
}

/** Вкладка "Статистика" — аналітика по кожному амбасадору. */
export interface AdminAmbassadorStatItem {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  referred_count: number;
  referred_with_deposit_count: number;
  total_real_deposit_ton: number;
}

export interface AdminAmbassadorStatsResponse {
  items: AdminAmbassadorStatItem[];
}

/** Вкладка "Ручне нарахування" — грант на game_balance за telegram_id, is_manual:true. */
export interface AdminGrantResponse {
  telegram_id: number;
  amount: number;
  game_balance: number;
  withdrawable_balance: number;
}
