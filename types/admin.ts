export interface AdminWithdrawalItem {
  transaction_id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  requested_amount: number;
  fee: number;
  net_payout: number;
  destination_address: string;
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
