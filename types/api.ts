import type { Tables } from "./database.types";

export type Profile = Tables<"profiles">;
export type GpuTemplate = Tables<"gpu_templates">;
export type UserGpu = Tables<"user_gpus">;

export interface SyncResponse {
  profile: Profile;
  user_gpus: UserGpu[];
  gpu_templates: GpuTemplate[];
  total_hash_per_second: number;
  /** TRUE лише для telegram_id зі списку TELEGRAM_ADMIN_IDS — сам список ніколи не йде в клієнт. */
  is_admin: boolean;
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

export interface ReviveGpuResponse {
  gpu_level: number;
  new_game_balance: number;
  revival_count: number;
  revival_cost: number;
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

export type WithdrawalStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "rejected";

export interface WithdrawalHistoryItem {
  transaction_id: string;
  requested_amount: number;
  fee: number;
  net_payout: number;
  destination_address: string;
  status: WithdrawalStatus;
  rejection_reason: string | null;
  payout_tx_hash: string | null;
  created_at: string;
}

export interface WithdrawalHistoryResponse {
  items: WithdrawalHistoryItem[];
}

export interface CreditedDepositItem {
  transaction_id: string;
  tx_hash: string;
  amount: number;
}

export interface DepositCheckResponse {
  /** Усі депозити, зараховані ЦИМ конкретним викликом — порожній масив, якщо нічого нового не знайдено. */
  credited: CreditedDepositItem[];
  game_balance: number;
  withdrawal_quota: number;
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

export interface PartnerAdWatchResponse {
  partner_ads_watched_today: number;
  daily_limit: number;
  reward_amount: number;
  withdrawable_balance: number;
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
  | "deposit_count"
  | "deposit_total_ton"
  | "harvest_total_hash"
  | "own_gpu_level"
  | "partner_postback";
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

// ---------------------------------------------------------------------------
// Daily Bonus (Щоденна нагорода)
// ---------------------------------------------------------------------------

export interface DailyBonusStatusResponse {
  can_claim: boolean;
  /** Скільки секунд лишилось до наступної доступності — 0, якщо can_claim. */
  cooldown_seconds: number;
  reward_amount: number;
  last_claim_at: string | null;
  server_time: string;
}

export interface DailyBonusClaimResponse {
  reward_amount: number;
  game_balance: number;
  withdrawable_balance: number;
  last_daily_bonus_at: string;
  server_time: string;
}
