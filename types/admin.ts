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
