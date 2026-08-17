import type { Tables } from "./database.types";

export type Profile = Tables<"profiles">;
export type GpuTemplate = Tables<"gpu_templates">;
export type UserGpu = Tables<"user_gpus">;

export interface SyncResponse {
  profile: Profile;
  user_gpus: UserGpu[];
  gpu_templates: GpuTemplate[];
  total_hash_per_second: number;
  server_time: string;
}

export interface HarvestResponse {
  harvested: number;
  hash_balance: number;
  game_balance: number;
  withdrawable_balance: number;
  server_time: string;
}

export interface BuyGpuResponse {
  gpu_level: number;
  new_game_balance: number;
  new_gpu_amount: number;
  hash_harvested: number;
  server_time: string;
}

export type ExchangeTargetBalance = "withdrawable" | "game";

export interface ExchangeResponse {
  hash_balance: number;
  game_balance: number;
  withdrawable_balance: number;
  ton_credited: number;
  fee_charged: number;
  server_time: string;
}

export interface ApiErrorResponse {
  error: string;
}

export interface ConvertBalanceResponse {
  withdrawable_balance: number;
  game_balance: number;
  server_time: string;
}

export interface WithdrawResponse {
  transaction_id: string;
  requested_amount: number;
  fee_charged: number;
  net_payout: number;
  destination_address: string;
  withdrawable_balance: number;
  withdrawal_quota: number;
  ads_watched_since_withdraw: number;
  server_time: string;
}

export interface DepositVerifyResponse {
  credited_amount: number;
  game_balance: number;
  withdrawal_quota: number;
  transaction_id: string;
  server_time: string;
}

export interface ClaimReferralResponse {
  claimed_amount: number;
  withdrawable_balance: number;
  server_time: string;
}

export interface AdWatchResponse {
  ads_watched_since_withdraw: number;
  withdrawal_quota: number;
  server_time: string;
}
