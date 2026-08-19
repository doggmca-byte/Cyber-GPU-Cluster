export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      gpu_templates: {
        Row: {
          cost_ton: number
          hash_per_second: number
          level: number
          max_limit: number
          name: string
          rarity: string
        }
        Insert: {
          cost_ton: number
          hash_per_second: number
          level: number
          max_limit?: number
          name: string
          rarity: string
        }
        Update: {
          cost_ton?: number
          hash_per_second?: number
          level?: number
          max_limit?: number
          name?: string
          rarity?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ads_quota_reset_date: string
          ads_watched_since_withdraw: number
          created_at: string
          first_name: string | null
          game_balance: number
          harvest_count: number
          hash_balance: number
          id: string
          is_ambassador: boolean
          last_daily_bonus_at: string | null
          last_withdrawal_request_date: string | null
          lifetime_deposited_ton: number
          lifetime_hash_generated: number
          partner_ads_reset_date: string
          partner_ads_watched_today: number
          referrer_id: string | null
          telegram_id: number
          username: string | null
          withdrawable_balance: number
          withdrawal_quota: number
          withdrawal_request_count: number
        }
        Insert: {
          ads_quota_reset_date?: string
          ads_watched_since_withdraw?: number
          created_at?: string
          first_name?: string | null
          game_balance?: number
          harvest_count?: number
          hash_balance?: number
          id?: string
          is_ambassador?: boolean
          last_daily_bonus_at?: string | null
          last_withdrawal_request_date?: string | null
          lifetime_deposited_ton?: number
          lifetime_hash_generated?: number
          partner_ads_reset_date?: string
          partner_ads_watched_today?: number
          referrer_id?: string | null
          telegram_id: number
          username?: string | null
          withdrawable_balance?: number
          withdrawal_quota?: number
          withdrawal_request_count?: number
        }
        Update: {
          ads_quota_reset_date?: string
          ads_watched_since_withdraw?: number
          created_at?: string
          first_name?: string | null
          game_balance?: number
          harvest_count?: number
          hash_balance?: number
          id?: string
          is_ambassador?: boolean
          last_daily_bonus_at?: string | null
          last_withdrawal_request_date?: string | null
          lifetime_deposited_ton?: number
          lifetime_hash_generated?: number
          partner_ads_reset_date?: string
          partner_ads_watched_today?: number
          referrer_id?: string | null
          telegram_id?: number
          username?: string | null
          withdrawable_balance?: number
          withdrawal_quota?: number
          withdrawal_request_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          has_reached_threshold: boolean
          id: string
          pending_reward: number
          referee_id: string
          referrer_id: string
          total_earned: number
        }
        Insert: {
          created_at?: string
          has_reached_threshold?: boolean
          id?: string
          pending_reward?: number
          referee_id: string
          referrer_id: string
          total_earned?: number
        }
        Update: {
          created_at?: string
          has_reached_threshold?: boolean
          id?: string
          pending_reward?: number
          referee_id?: string
          referrer_id?: string
          total_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          action_type: string
          category: string
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          reward_amount: number
          reward_type: string
          sort_order: number
          target_value: string
          title_key: string
        }
        Insert: {
          action_type: string
          category: string
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          reward_amount: number
          reward_type: string
          sort_order?: number
          target_value: string
          title_key: string
        }
        Update: {
          action_type?: string
          category?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          reward_amount?: number
          reward_type?: string
          sort_order?: number
          target_value?: string
          title_key?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          fee: number
          id: string
          is_manual: boolean
          payload: Json
          status: string
          tx_hash: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fee?: number
          id?: string
          is_manual?: boolean
          payload?: Json
          status?: string
          tx_hash?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fee?: number
          id?: string
          is_manual?: boolean
          payload?: Json
          status?: string
          tx_hash?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_gpus: {
        Row: {
          amount: number
          gpu_level: number
          id: string
          is_dead: boolean
          last_harvest_at: string
          lifetime_hash_generated: number
          revival_count: number
          user_id: string
        }
        Insert: {
          amount?: number
          gpu_level: number
          id?: string
          is_dead?: boolean
          last_harvest_at?: string
          lifetime_hash_generated?: number
          revival_count?: number
          user_id: string
        }
        Update: {
          amount?: number
          gpu_level?: number
          id?: string
          is_dead?: boolean
          last_harvest_at?: string
          lifetime_hash_generated?: number
          revival_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_gpus_gpu_level_fkey"
            columns: ["gpu_level"]
            isOneToOne: false
            referencedRelation: "gpu_templates"
            referencedColumns: ["level"]
          },
          {
            foreignKeyName: "user_gpus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tasks: {
        Row: {
          claimed_at: string | null
          created_at: string
          id: string
          status: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          status?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          status?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_grant_balance: {
        Args: {
          p_admin_telegram_id: string
          p_amount: number
          p_user_id: string
        }
        Returns: {
          game_balance: number
          withdrawable_balance: number
        }[]
      }
      approve_withdrawal: {
        Args: { p_payout_tx_hash: string; p_transaction_id: string }
        Returns: {
          status: string
          transaction_id: string
          tx_hash: string
        }[]
      }
      begin_withdrawal_payout: {
        Args: { p_transaction_id: string }
        Returns: {
          destination_address: string
          net_payout: number
          requested_amount: number
          transaction_id: string
        }[]
      }
      buy_gpu: {
        Args: { p_level: number; p_user_id: string }
        Returns: {
          hash_harvested: number
          new_game_balance: number
          new_gpu_amount: number
        }[]
      }
      claim_daily_bonus: {
        Args: { p_reward_amount: number; p_user_id: string }
        Returns: {
          game_balance: number
          last_daily_bonus_at: string
          withdrawable_balance: number
        }[]
      }
      claim_referral_rewards: {
        Args: { p_user_id: string }
        Returns: {
          claimed_amount: number
          withdrawable_balance: number
        }[]
      }
      claim_task_reward: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: {
          game_balance: number
          reward_amount: number
          reward_type: string
          status: string
          task_id: string
          withdrawable_balance: number
          withdrawal_quota: number
        }[]
      }
      convert_withdrawable_to_game: {
        Args: { p_amount: number; p_user_id: string }
        Returns: {
          game_balance: number
          withdrawable_balance: number
        }[]
      }
      exchange_hash_to_ton: {
        Args: {
          p_hash_amount: number
          p_target_balance: string
          p_user_id: string
        }
        Returns: {
          fee_charged: number
          game_balance: number
          hash_balance: number
          ton_credited: number
          withdrawable_balance: number
        }[]
      }
      harvest_user_hash: { Args: { p_user_id: string }; Returns: number }
      process_successful_deposit: {
        Args: { p_amount: number; p_tx_hash: string; p_user_id: string }
        Returns: {
          game_balance: number
          transaction_id: string
          withdrawal_quota: number
        }[]
      }
      record_ad_watch: {
        Args: { p_user_id: string }
        Returns: {
          ads_watched_since_withdraw: number
          withdrawal_quota: number
        }[]
      }
      record_partner_ad_watch: {
        Args: { p_user_id: string }
        Returns: {
          daily_limit: number
          partner_ads_watched_today: number
          reward_amount: number
          withdrawable_balance: number
        }[]
      }
      reject_withdrawal: {
        Args: { p_reason: string; p_transaction_id: string }
        Returns: {
          refunded_amount: number
          status: string
          transaction_id: string
          withdrawable_balance: number
          withdrawal_quota: number
        }[]
      }
      request_withdrawal: {
        Args: {
          p_amount: number
          p_destination_address: string
          p_user_id: string
        }
        Returns: {
          ads_watched_since_withdraw: number
          destination_address: string
          fee_charged: number
          net_payout: number
          requested_amount: number
          transaction_id: string
          withdrawable_balance: number
          withdrawal_quota: number
        }[]
      }
      revert_withdrawal_to_pending: {
        Args: { p_reason: string; p_transaction_id: string }
        Returns: {
          status: string
          transaction_id: string
        }[]
      }
      revive_gpu: {
        Args: { p_level: number; p_user_id: string }
        Returns: {
          new_game_balance: number
          revival_cost: number
          revival_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
