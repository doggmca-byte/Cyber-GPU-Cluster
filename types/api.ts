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

// ---------------------------------------------------------------------------
// Task Center (Центр Завдань)
// ---------------------------------------------------------------------------

export type TaskCategory = "in_game" | "general" | "partners" | "wallet" | "friends" | "special";
export type TaskRewardType = "game_balance" | "ton" | "quota";
export type TaskActionType =
  | "telegram_channel"
  | "external_link"
  | "own_gpus_count"
  | "harvest_count"
  | "invite_count"
  | "deposit_count";
export type TaskStatus = "pending" | "completed" | "claimed";

export interface TaskItem {
  id: string;
  category: TaskCategory;
  /** Слаг для lib/i18n/dictionaries — t.tasks.items[title_key], НЕ повний шлях. */
  title_key: string;
  icon: string | null;
  reward_amount: number;
  reward_type: TaskRewardType;
  action_type: TaskActionType;
  target_value: string;
  status: TaskStatus;
  /** Лише для *_count завдань — живе значення/поріг, обчислені на GET /api/tasks. */
  progress_current?: number;
  progress_target?: number;
}

export interface TasksResponse {
  tasks: TaskItem[];
  completed_count: number;
  total_count: number;
  server_time: string;
}

export interface TaskVerifyResponse {
  task_id: string;
  status: TaskStatus;
  completed: boolean;
  server_time: string;
}

export interface TaskClaimResponse {
  task_id: string;
  status: TaskStatus;
  reward_amount: number;
  reward_type: TaskRewardType;
  game_balance: number;
  withdrawable_balance: number;
  withdrawal_quota: number;
  server_time: string;
}
