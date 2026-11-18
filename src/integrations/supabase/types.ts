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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          code: string
          condition_json: Json
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          condition_json?: Json
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          condition_json?: Json
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      admin_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          ip: string | null
          metadata: Json
          reason: string | null
          session_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          reason?: string | null
          session_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          reason?: string | null
          session_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          permission: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: []
      }
      affiliate_commission_logs: {
        Row: {
          changed_by: string | null
          commission_id: string
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          commission_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          commission_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commission_logs_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "affiliate_commissions"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          applied_rebate_rate: number | null
          base_amount: number
          charge_request_id: string | null
          commission_amount: number
          commission_rate: number
          created_at: string
          id: string
          member_user_id: string
          settled_at: string | null
          settled_by: string | null
          status: string
        }
        Insert: {
          affiliate_id: string
          applied_rebate_rate?: number | null
          base_amount?: number
          charge_request_id?: string | null
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          member_user_id: string
          settled_at?: string | null
          settled_by?: string | null
          status?: string
        }
        Update: {
          affiliate_id?: string
          applied_rebate_rate?: number | null
          base_amount?: number
          charge_request_id?: string | null
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          member_user_id?: string
          settled_at?: string | null
          settled_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_members: {
        Row: {
          affiliate_id: string
          id: string
          joined_at: string
          member_user_id: string
        }
        Insert: {
          affiliate_id: string
          id?: string
          joined_at?: string
          member_user_id: string
        }
        Update: {
          affiliate_id?: string
          id?: string
          joined_at?: string
          member_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_members_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          affiliate_code: string
          created_at: string
          id: string
          memo: string | null
          rebate_rate: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_code: string
          created_at?: string
          id?: string
          memo?: string | null
          rebate_rate?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_code?: string
          created_at?: string
          id?: string
          memo?: string | null
          rebate_rate?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      card_assets: {
        Row: {
          asset_url: string
          card_identity: string | null
          created_at: string
          enabled: boolean
          id: string
          is_gwang: boolean
          month: number
          name: string
          special_type: string | null
          updated_at: string
          variant: string
        }
        Insert: {
          asset_url: string
          card_identity?: string | null
          created_at?: string
          enabled?: boolean
          id: string
          is_gwang?: boolean
          month: number
          name: string
          special_type?: string | null
          updated_at?: string
          variant: string
        }
        Update: {
          asset_url?: string
          card_identity?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          is_gwang?: boolean
          month?: number
          name?: string
          special_type?: string | null
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      chain_deposits: {
        Row: {
          amount_atomic: number
          amount_usdt: number
          block_number: number | null
          block_timestamp: string | null
          charge_request_id: string | null
          confirmations: number
          confirmed: boolean
          created_at: string
          detected_at: string
          from_address: string | null
          id: string
          network: string
          note: string | null
          processed_at: string | null
          status: string
          to_address: string
          token_contract: string
          txid: string
          updated_at: string
        }
        Insert: {
          amount_atomic: number
          amount_usdt: number
          block_number?: number | null
          block_timestamp?: string | null
          charge_request_id?: string | null
          confirmations?: number
          confirmed?: boolean
          created_at?: string
          detected_at?: string
          from_address?: string | null
          id?: string
          network?: string
          note?: string | null
          processed_at?: string | null
          status?: string
          to_address: string
          token_contract: string
          txid: string
          updated_at?: string
        }
        Update: {
          amount_atomic?: number
          amount_usdt?: number
          block_number?: number | null
          block_timestamp?: string | null
          charge_request_id?: string | null
          confirmations?: number
          confirmed?: boolean
          created_at?: string
          detected_at?: string
          from_address?: string | null
          id?: string
          network?: string
          note?: string | null
          processed_at?: string | null
          status?: string
          to_address?: string
          token_contract?: string
          txid?: string
          updated_at?: string
        }
        Relationships: []
      }
      charge_request_logs: {
        Row: {
          changed_by: string | null
          charge_request_id: string
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          charge_request_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          charge_request_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_request_logs_charge_request_id_fkey"
            columns: ["charge_request_id"]
            isOneToOne: false
            referencedRelation: "charge_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_requests: {
        Row: {
          admin_note: string | null
          affiliate_commission_amount: number | null
          affiliate_id: string | null
          company_fee_amount: number | null
          conversion_rate: number
          credited_base_amount: number | null
          credited_points: number | null
          depositor_name: string
          fee_amount: number | null
          id: string
          point_amount: number
          processed_at: string | null
          processed_by: string | null
          rake_free_ticket_id: string | null
          rake_free_ticket_used: boolean
          requested_amount: number
          requested_at: string
          status: string
          user_id: string
          user_note: string | null
        }
        Insert: {
          admin_note?: string | null
          affiliate_commission_amount?: number | null
          affiliate_id?: string | null
          company_fee_amount?: number | null
          conversion_rate: number
          credited_base_amount?: number | null
          credited_points?: number | null
          depositor_name: string
          fee_amount?: number | null
          id?: string
          point_amount: number
          processed_at?: string | null
          processed_by?: string | null
          rake_free_ticket_id?: string | null
          rake_free_ticket_used?: boolean
          requested_amount: number
          requested_at?: string
          status?: string
          user_id: string
          user_note?: string | null
        }
        Update: {
          admin_note?: string | null
          affiliate_commission_amount?: number | null
          affiliate_id?: string | null
          company_fee_amount?: number | null
          conversion_rate?: number
          credited_base_amount?: number | null
          credited_points?: number | null
          depositor_name?: string
          fee_amount?: number | null
          id?: string
          point_amount?: number
          processed_at?: string | null
          processed_by?: string | null
          rake_free_ticket_id?: string | null
          rake_free_ticket_used?: boolean
          requested_amount?: number
          requested_at?: string
          status?: string
          user_id?: string
          user_note?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          room_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          message: string
          room_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          room_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_charge_requests: {
        Row: {
          actual_usdt: number | null
          affiliate_commission: number | null
          affiliate_id: string | null
          asset: string
          cancelled_at: string | null
          chain_deposit_id: string | null
          company_fee: number | null
          confirmed_at: string | null
          created_at: string
          credited_at: string | null
          credited_krw: number | null
          credited_points: number | null
          error_code: string | null
          error_message: string | null
          expected_usdt: number
          expected_usdt_atomic: number
          expires_at: string
          fee_amount: number | null
          id: string
          manual_action: string | null
          manual_admin_id: string | null
          manual_at: string | null
          manual_reason: string | null
          matched_at: string | null
          network: string
          rate_krw_per_usdt: number
          requested_krw: number
          requested_usdt: number
          status: string
          txid: string | null
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          actual_usdt?: number | null
          affiliate_commission?: number | null
          affiliate_id?: string | null
          asset?: string
          cancelled_at?: string | null
          chain_deposit_id?: string | null
          company_fee?: number | null
          confirmed_at?: string | null
          created_at?: string
          credited_at?: string | null
          credited_krw?: number | null
          credited_points?: number | null
          error_code?: string | null
          error_message?: string | null
          expected_usdt: number
          expected_usdt_atomic: number
          expires_at: string
          fee_amount?: number | null
          id?: string
          manual_action?: string | null
          manual_admin_id?: string | null
          manual_at?: string | null
          manual_reason?: string | null
          matched_at?: string | null
          network?: string
          rate_krw_per_usdt: number
          requested_krw: number
          requested_usdt: number
          status?: string
          txid?: string | null
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          actual_usdt?: number | null
          affiliate_commission?: number | null
          affiliate_id?: string | null
          asset?: string
          cancelled_at?: string | null
          chain_deposit_id?: string | null
          company_fee?: number | null
          confirmed_at?: string | null
          created_at?: string
          credited_at?: string | null
          credited_krw?: number | null
          credited_points?: number | null
          error_code?: string | null
          error_message?: string | null
          expected_usdt?: number
          expected_usdt_atomic?: number
          expires_at?: string
          fee_amount?: number | null
          id?: string
          manual_action?: string | null
          manual_admin_id?: string | null
          manual_at?: string | null
          manual_reason?: string | null
          matched_at?: string | null
          network?: string
          rate_krw_per_usdt?: number
          requested_krw?: number
          requested_usdt?: number
          status?: string
          txid?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      custom_profile_purchases: {
        Row: {
          created_at: string
          days: number
          expires_at: string
          id: string
          price: number
          request_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          days: number
          expires_at: string
          id?: string
          price: number
          request_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          days?: number
          expires_at?: string
          id?: string
          price?: number
          request_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      custom_profiles: {
        Row: {
          active: boolean
          created_at: string
          disabled_reason: string | null
          expires_at: string | null
          image_bytes: number | null
          image_height: number | null
          image_mime: string | null
          image_path: string | null
          image_updated_at: string | null
          image_width: number | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          disabled_reason?: string | null
          expires_at?: string | null
          image_bytes?: number | null
          image_height?: number | null
          image_mime?: string | null
          image_path?: string | null
          image_updated_at?: string | null
          image_width?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          disabled_reason?: string | null
          expires_at?: string | null
          image_bytes?: number | null
          image_height?: number | null
          image_mime?: string | null
          image_path?: string | null
          image_updated_at?: string | null
          image_width?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_titles: {
        Row: {
          activated_at: string
          created_at: string
          disabled_reason: string | null
          equipped: boolean
          expires_at: string
          id: string
          item_id: string | null
          normalized_title: string
          price: number
          purchased_at: string
          request_id: string | null
          status: string
          title_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string
          created_at?: string
          disabled_reason?: string | null
          equipped?: boolean
          expires_at: string
          id?: string
          item_id?: string | null
          normalized_title: string
          price?: number
          purchased_at?: string
          request_id?: string | null
          status?: string
          title_text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string
          created_at?: string
          disabled_reason?: string | null
          equipped?: boolean
          expires_at?: string
          id?: string
          item_id?: string | null
          normalized_title?: string
          price?: number
          purchased_at?: string
          request_id?: string | null
          status?: string
          title_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dori_actions: {
        Row: {
          action_id: string
          action_type: string
          amount: number
          betting_round: number
          created_at: string
          id: string
          raise_index: number | null
          round_id: string
          turn_number: number
          user_id: string
        }
        Insert: {
          action_id?: string
          action_type: string
          amount?: number
          betting_round?: number
          created_at?: string
          id?: string
          raise_index?: number | null
          round_id: string
          turn_number?: number
          user_id: string
        }
        Update: {
          action_id?: string
          action_type?: string
          amount?: number
          betting_round?: number
          created_at?: string
          id?: string
          raise_index?: number | null
          round_id?: string
          turn_number?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_actions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "dori_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_cards: {
        Row: {
          card_code: string
          deal_order: number
          id: string
          month_value: number
          round_id: string
          user_id: string
        }
        Insert: {
          card_code: string
          deal_order: number
          id?: string
          month_value: number
          round_id: string
          user_id: string
        }
        Update: {
          card_code?: string
          deal_order?: number
          id?: string
          month_value?: number
          round_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_cards_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "dori_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_chat_messages: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          nickname: string | null
          room_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          message: string
          nickname?: string | null
          room_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          nickname?: string | null
          room_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dori_chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "dori_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_hand_submissions: {
        Row: {
          created_at: string
          hand_code: string | null
          hand_label: string
          hand_rank: number
          hand_type: string
          id: string
          make_total: number
          remaining_card_ids: string[]
          round_id: string
          selected_card_ids: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          hand_code?: string | null
          hand_label: string
          hand_rank: number
          hand_type: string
          id?: string
          make_total: number
          remaining_card_ids: string[]
          round_id: string
          selected_card_ids: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          hand_code?: string | null
          hand_label?: string
          hand_rank?: number
          hand_type?: string
          id?: string
          make_total?: number
          remaining_card_ids?: string[]
          round_id?: string
          selected_card_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_hand_submissions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "dori_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_room_players: {
        Row: {
          absence_miss_count: number
          connection_status: string
          entry_balance_snapshot: number | null
          id: string
          is_ready: boolean
          joined_at: string
          last_seen_at: string
          leave_pending: boolean
          leave_requested_at: string | null
          long_absence: boolean
          missed_turn_count: number
          ready_at: string | null
          room_id: string
          seat: number
          user_id: string
        }
        Insert: {
          absence_miss_count?: number
          connection_status?: string
          entry_balance_snapshot?: number | null
          id?: string
          is_ready?: boolean
          joined_at?: string
          last_seen_at?: string
          leave_pending?: boolean
          leave_requested_at?: string | null
          long_absence?: boolean
          missed_turn_count?: number
          ready_at?: string | null
          room_id: string
          seat: number
          user_id: string
        }
        Update: {
          absence_miss_count?: number
          connection_status?: string
          entry_balance_snapshot?: number | null
          id?: string
          is_ready?: boolean
          joined_at?: string
          last_seen_at?: string
          leave_pending?: boolean
          leave_requested_at?: string | null
          long_absence?: boolean
          missed_turn_count?: number
          ready_at?: string | null
          room_id?: string
          seat?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "dori_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_room_secrets: {
        Row: {
          created_at: string
          password_hash: string
          room_id: string
        }
        Insert: {
          created_at?: string
          password_hash: string
          room_id: string
        }
        Update: {
          created_at?: string
          password_hash?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_room_secrets_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "dori_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_rooms: {
        Row: {
          ante: number
          carry_pot: number
          close_reason: string | null
          closed_at: string | null
          created_at: string
          current_round_id: string | null
          game_type: string
          id: string
          is_private: boolean
          keep_dealer: boolean
          last_dealer_seat: number | null
          max_players: number
          min_points: number
          owner_id: string
          room_number: number
          room_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ante?: number
          carry_pot?: number
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_round_id?: string | null
          game_type?: string
          id?: string
          is_private?: boolean
          keep_dealer?: boolean
          last_dealer_seat?: number | null
          max_players?: number
          min_points?: number
          owner_id: string
          room_number?: number
          room_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          ante?: number
          carry_pot?: number
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_round_id?: string | null
          game_type?: string
          id?: string
          is_private?: boolean
          keep_dealer?: boolean
          last_dealer_seat?: number | null
          max_players?: number
          min_points?: number
          owner_id?: string
          room_number?: number
          room_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      dori_round_players: {
        Row: {
          acted: boolean
          all_in_at: string | null
          connection_status: string
          contribution: number
          effective_rank: number | null
          final_points: number | null
          folded: boolean
          hand_code: string | null
          hand_label: string | null
          hand_rank: number | null
          hand_type: string | null
          id: string
          initial_points: number
          is_all_in: boolean
          make_status: string
          make_total: number | null
          result_type: string | null
          round_bet: number
          round_id: string
          seat: number
          user_id: string
        }
        Insert: {
          acted?: boolean
          all_in_at?: string | null
          connection_status?: string
          contribution?: number
          effective_rank?: number | null
          final_points?: number | null
          folded?: boolean
          hand_code?: string | null
          hand_label?: string | null
          hand_rank?: number | null
          hand_type?: string | null
          id?: string
          initial_points?: number
          is_all_in?: boolean
          make_status?: string
          make_total?: number | null
          result_type?: string | null
          round_bet?: number
          round_id: string
          seat: number
          user_id: string
        }
        Update: {
          acted?: boolean
          all_in_at?: string | null
          connection_status?: string
          contribution?: number
          effective_rank?: number | null
          final_points?: number | null
          folded?: boolean
          hand_code?: string | null
          hand_label?: string | null
          hand_rank?: number | null
          hand_type?: string | null
          id?: string
          initial_points?: number
          is_all_in?: boolean
          make_status?: string
          make_total?: number | null
          result_type?: string | null
          round_bet?: number
          round_id?: string
          seat?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dori_round_players_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "dori_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      dori_rounds: {
        Row: {
          ante: number
          carry_pot: number
          created_at: string
          current_bet: number
          current_turn_user_id: string | null
          dealer_seat: number
          deck: string[]
          deck_pos: number
          finished_at: string | null
          game_type: string
          id: string
          last_activity_at: string
          phase: string
          pot: number
          raise_count: number
          rematch_reason: string | null
          reveal_choice: string
          room_id: string
          round_number: number
          settled_at: string | null
          settlement_status: string
          status: string
          turn_deadline_at: string | null
          winner_id: string | null
        }
        Insert: {
          ante?: number
          carry_pot?: number
          created_at?: string
          current_bet?: number
          current_turn_user_id?: string | null
          dealer_seat: number
          deck?: string[]
          deck_pos?: number
          finished_at?: string | null
          game_type?: string
          id?: string
          last_activity_at?: string
          phase?: string
          pot?: number
          raise_count?: number
          rematch_reason?: string | null
          reveal_choice?: string
          room_id: string
          round_number?: number
          settled_at?: string | null
          settlement_status?: string
          status?: string
          turn_deadline_at?: string | null
          winner_id?: string | null
        }
        Update: {
          ante?: number
          carry_pot?: number
          created_at?: string
          current_bet?: number
          current_turn_user_id?: string | null
          dealer_seat?: number
          deck?: string[]
          deck_pos?: number
          finished_at?: string | null
          game_type?: string
          id?: string
          last_activity_at?: string
          phase?: string
          pot?: number
          raise_count?: number
          rematch_reason?: string | null
          reveal_choice?: string
          room_id?: string
          round_number?: number
          settled_at?: string | null
          settlement_status?: string
          status?: string
          turn_deadline_at?: string | null
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dori_rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "dori_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      event_popups: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_link: string | null
          cta_type: string
          ends_at: string | null
          id: string
          image_url: string | null
          placement: string
          priority: number
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_link?: string | null
          cta_type?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          placement?: string
          priority?: number
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_link?: string | null
          cta_type?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          placement?: string
          priority?: number
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      friends: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
        }
        Relationships: []
      }
      game_actions: {
        Row: {
          action_id: string
          action_type: string
          amount: number
          created_at: string
          id: string
          round_id: string
          turn_number: number
          user_id: string
        }
        Insert: {
          action_id?: string
          action_type: string
          amount?: number
          created_at?: string
          id?: string
          round_id: string
          turn_number?: number
          user_id: string
        }
        Update: {
          action_id?: string
          action_type?: string
          amount?: number
          created_at?: string
          id?: string
          round_id?: string
          turn_number?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_actions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "game_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      game_cards: {
        Row: {
          card_code: string
          card_order: number
          id: string
          round_id: string
          user_id: string
        }
        Insert: {
          card_code: string
          card_order?: number
          id?: string
          round_id: string
          user_id: string
        }
        Update: {
          card_code?: string
          card_order?: number
          id?: string
          round_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_cards_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "game_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      game_error_logs: {
        Row: {
          action: string | null
          error_code: string | null
          error_message: string
          fn: string
          id: string
          metadata: Json
          occurred_at: string
          phase: string | null
          retried: boolean
          room_id: string | null
          round_id: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          error_code?: string | null
          error_message: string
          fn: string
          id?: string
          metadata?: Json
          occurred_at?: string
          phase?: string | null
          retried?: boolean
          room_id?: string | null
          round_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          error_code?: string | null
          error_message?: string
          fn?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          phase?: string | null
          retried?: boolean
          room_id?: string | null
          round_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      game_room_players: {
        Row: {
          connection_status: string
          entry_balance_snapshot: number | null
          id: string
          is_ready: boolean
          is_spectator: boolean
          joined_at: string
          last_seen_at: string
          leave_pending: boolean
          leave_requested_at: string | null
          missed_turn_count: number
          ready: boolean
          ready_at: string | null
          room_id: string
          seat: number
          seat_status: string
          user_id: string
        }
        Insert: {
          connection_status?: string
          entry_balance_snapshot?: number | null
          id?: string
          is_ready?: boolean
          is_spectator?: boolean
          joined_at?: string
          last_seen_at?: string
          leave_pending?: boolean
          leave_requested_at?: string | null
          missed_turn_count?: number
          ready?: boolean
          ready_at?: string | null
          room_id: string
          seat: number
          seat_status?: string
          user_id: string
        }
        Update: {
          connection_status?: string
          entry_balance_snapshot?: number | null
          id?: string
          is_ready?: boolean
          is_spectator?: boolean
          joined_at?: string
          last_seen_at?: string
          leave_pending?: boolean
          leave_requested_at?: string | null
          missed_turn_count?: number
          ready?: boolean
          ready_at?: string | null
          room_id?: string
          seat?: number
          seat_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      game_rooms: {
        Row: {
          base_bet: number
          carry_caps: Json
          carry_pot: number
          channel_no: number
          close_reason: string | null
          closed_at: string | null
          created_at: string
          current_players: number
          current_round_id: string | null
          deleted_at: string | null
          friends_only: boolean
          game_mode: string
          host_id: string
          id: string
          is_test_room: boolean
          max_players: number
          min_points: number
          password_hash: string | null
          ready_required: boolean
          rematch_pending: boolean
          rematch_users: string[]
          room_code: string | null
          room_number: number
          room_type: string
          spectator_enabled: boolean
          status: string
          title: string
          visibility: string
        }
        Insert: {
          base_bet?: number
          carry_caps?: Json
          carry_pot?: number
          channel_no?: number
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_players?: number
          current_round_id?: string | null
          deleted_at?: string | null
          friends_only?: boolean
          game_mode?: string
          host_id: string
          id?: string
          is_test_room?: boolean
          max_players?: number
          min_points?: number
          password_hash?: string | null
          ready_required?: boolean
          rematch_pending?: boolean
          rematch_users?: string[]
          room_code?: string | null
          room_number?: number
          room_type?: string
          spectator_enabled?: boolean
          status?: string
          title: string
          visibility?: string
        }
        Update: {
          base_bet?: number
          carry_caps?: Json
          carry_pot?: number
          channel_no?: number
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_players?: number
          current_round_id?: string | null
          deleted_at?: string | null
          friends_only?: boolean
          game_mode?: string
          host_id?: string
          id?: string
          is_test_room?: boolean
          max_players?: number
          min_points?: number
          password_hash?: string | null
          ready_required?: boolean
          rematch_pending?: boolean
          rematch_users?: string[]
          room_code?: string | null
          room_number?: number
          room_type?: string
          spectator_enabled?: boolean
          status?: string
          title?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_rooms_room_type_fkey"
            columns: ["room_type"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      game_round_players: {
        Row: {
          acted: boolean
          all_in_at: string | null
          carry_bet: number
          connection_status: string
          final_points: number | null
          folded: boolean
          hand_code: string | null
          hand_rank: string | null
          id: string
          initial_points: number
          is_all_in: boolean
          last_seen_at: string
          open_card: string | null
          player_status: string
          reconnect_deadline_at: string | null
          result: string | null
          result_type: string | null
          round_id: string
          seat: number
          selected_cards: Json | null
          selection_confirmed_at: string | null
          total_bet: number
          user_id: string
        }
        Insert: {
          acted?: boolean
          all_in_at?: string | null
          carry_bet?: number
          connection_status?: string
          final_points?: number | null
          folded?: boolean
          hand_code?: string | null
          hand_rank?: string | null
          id?: string
          initial_points?: number
          is_all_in?: boolean
          last_seen_at?: string
          open_card?: string | null
          player_status?: string
          reconnect_deadline_at?: string | null
          result?: string | null
          result_type?: string | null
          round_id: string
          seat: number
          selected_cards?: Json | null
          selection_confirmed_at?: string | null
          total_bet?: number
          user_id: string
        }
        Update: {
          acted?: boolean
          all_in_at?: string | null
          carry_bet?: number
          connection_status?: string
          final_points?: number | null
          folded?: boolean
          hand_code?: string | null
          hand_rank?: string | null
          id?: string
          initial_points?: number
          is_all_in?: boolean
          last_seen_at?: string
          open_card?: string | null
          player_status?: string
          reconnect_deadline_at?: string | null
          result?: string | null
          result_type?: string | null
          round_id?: string
          seat?: number
          selected_cards?: Json | null
          selection_confirmed_at?: string | null
          total_bet?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_round_players_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "game_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      game_rounds: {
        Row: {
          base_bet: number
          carry_in: number
          current_bet: number
          current_turn_user_id: string | null
          dealer_seat: number
          deck: string[]
          deck_pos: number
          finished_at: string | null
          fold_win_reveal_choice: string | null
          fold_win_reveal_deadline: string | null
          game_mode: string
          id: string
          is_rematch: boolean
          last_activity_at: string
          paused_reason: string | null
          phase: string
          pot: number
          room_id: string
          round_number: number
          settled: boolean
          settled_at: string | null
          settlement_id: string | null
          settlement_status: string
          stage: number
          started_at: string
          status: string
          turn_deadline_at: string | null
          winner_id: string | null
        }
        Insert: {
          base_bet?: number
          carry_in?: number
          current_bet?: number
          current_turn_user_id?: string | null
          dealer_seat?: number
          deck?: string[]
          deck_pos?: number
          finished_at?: string | null
          fold_win_reveal_choice?: string | null
          fold_win_reveal_deadline?: string | null
          game_mode?: string
          id?: string
          is_rematch?: boolean
          last_activity_at?: string
          paused_reason?: string | null
          phase?: string
          pot?: number
          room_id: string
          round_number?: number
          settled?: boolean
          settled_at?: string | null
          settlement_id?: string | null
          settlement_status?: string
          stage?: number
          started_at?: string
          status?: string
          turn_deadline_at?: string | null
          winner_id?: string | null
        }
        Update: {
          base_bet?: number
          carry_in?: number
          current_bet?: number
          current_turn_user_id?: string | null
          dealer_seat?: number
          deck?: string[]
          deck_pos?: number
          finished_at?: string | null
          fold_win_reveal_choice?: string | null
          fold_win_reveal_deadline?: string | null
          game_mode?: string
          id?: string
          is_rematch?: boolean
          last_activity_at?: string
          paused_reason?: string | null
          phase?: string
          pot?: number
          room_id?: string
          round_number?: number
          settled?: boolean
          settled_at?: string | null
          settlement_id?: string | null
          settlement_status?: string
          stage?: number
          started_at?: string
          status?: string
          turn_deadline_at?: string | null
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      integrity_findings: {
        Row: {
          code: string
          detail: Json
          first_seen_at: string
          id: string
          occurred_at: string | null
          reason: string | null
          scope: string
          status: string
          subject_id: string | null
          subject_label: string | null
          subject_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          detail?: Json
          first_seen_at?: string
          id?: string
          occurred_at?: string | null
          reason?: string | null
          scope?: string
          status?: string
          subject_id?: string | null
          subject_label?: string | null
          subject_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          detail?: Json
          first_seen_at?: string
          id?: string
          occurred_at?: string | null
          reason?: string | null
          scope?: string
          status?: string
          subject_id?: string | null
          subject_label?: string | null
          subject_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      items: {
        Row: {
          asset_url: string | null
          category: string
          created_at: string
          description: string | null
          duration_days: number
          effect_key: string | null
          enabled: boolean
          for_sale: boolean
          id: string
          images: Json
          name: string
          price: number
          rank_required: Database["public"]["Enums"]["app_rank"] | null
          rarity: string
          sort_order: number
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          asset_url?: string | null
          category: string
          created_at?: string
          description?: string | null
          duration_days?: number
          effect_key?: string | null
          enabled?: boolean
          for_sale?: boolean
          id?: string
          images?: Json
          name: string
          price?: number
          rank_required?: Database["public"]["Enums"]["app_rank"] | null
          rarity?: string
          sort_order?: number
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          asset_url?: string | null
          category?: string
          created_at?: string
          description?: string | null
          duration_days?: number
          effect_key?: string | null
          enabled?: boolean
          for_sale?: boolean
          id?: string
          images?: Json
          name?: string
          price?: number
          rank_required?: Database["public"]["Enums"]["app_rank"] | null
          rarity?: string
          sort_order?: number
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notices: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          pinned: boolean
          published: boolean
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          pinned?: boolean
          published?: boolean
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          pinned?: boolean
          published?: boolean
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      point_transactions: {
        Row: {
          admin_id: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          locked_after: number
          locked_before: number
          memo: string | null
          reference_id: string | null
          reference_type: string | null
          type: string
          user_id: string
        }
        Insert: {
          admin_id?: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          locked_after?: number
          locked_before?: number
          memo?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type: string
          user_id: string
        }
        Update: {
          admin_id?: string | null
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          locked_after?: number
          locked_before?: number
          memo?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          attendance_count: number
          avatar_url: string | null
          chat_banned_until: string | null
          created_at: string
          current_streak: number
          email: string | null
          exp: number
          game_points: number
          gwangttaeng_count: number
          id: string
          is_test_user: boolean
          last_seen_at: string
          level: number
          locked_points: number
          losses: number
          max_streak: number
          nickname: string
          rank: Database["public"]["Enums"]["app_rank"]
          rank_points: number
          referred_by_affiliate_id: string | null
          risk_level: string
          risk_note: string | null
          sanction_reason: string | null
          signup_code_used: string | null
          status: string
          suspended_until: string | null
          telegram_id: string | null
          total_charge_amount: number
          total_charge_count: number
          username: string | null
          wallet_address: string | null
          wins: number
        }
        Insert: {
          attendance_count?: number
          avatar_url?: string | null
          chat_banned_until?: string | null
          created_at?: string
          current_streak?: number
          email?: string | null
          exp?: number
          game_points?: number
          gwangttaeng_count?: number
          id: string
          is_test_user?: boolean
          last_seen_at?: string
          level?: number
          locked_points?: number
          losses?: number
          max_streak?: number
          nickname: string
          rank?: Database["public"]["Enums"]["app_rank"]
          rank_points?: number
          referred_by_affiliate_id?: string | null
          risk_level?: string
          risk_note?: string | null
          sanction_reason?: string | null
          signup_code_used?: string | null
          status?: string
          suspended_until?: string | null
          telegram_id?: string | null
          total_charge_amount?: number
          total_charge_count?: number
          username?: string | null
          wallet_address?: string | null
          wins?: number
        }
        Update: {
          attendance_count?: number
          avatar_url?: string | null
          chat_banned_until?: string | null
          created_at?: string
          current_streak?: number
          email?: string | null
          exp?: number
          game_points?: number
          gwangttaeng_count?: number
          id?: string
          is_test_user?: boolean
          last_seen_at?: string
          level?: number
          locked_points?: number
          losses?: number
          max_streak?: number
          nickname?: string
          rank?: Database["public"]["Enums"]["app_rank"]
          rank_points?: number
          referred_by_affiliate_id?: string | null
          risk_level?: string
          risk_note?: string | null
          sanction_reason?: string | null
          signup_code_used?: string | null
          status?: string
          suspended_until?: string | null
          telegram_id?: string | null
          total_charge_amount?: number
          total_charge_count?: number
          username?: string | null
          wallet_address?: string | null
          wins?: number
        }
        Relationships: []
      }
      rake_free_tickets: {
        Row: {
          charge_request_id: string | null
          id: string
          issued_at: string
          reserved_at: string | null
          source_ref: string | null
          source_type: string
          status: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          charge_request_id?: string | null
          id?: string
          issued_at?: string
          reserved_at?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          charge_request_id?: string | null
          id?: string
          issued_at?: string
          reserved_at?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rank_promotions: {
        Row: {
          attendance_at: number
          charge_amount_at: number
          charge_count_at: number
          created_at: string
          from_rank: Database["public"]["Enums"]["app_rank"]
          id: string
          to_rank: Database["public"]["Enums"]["app_rank"]
          user_id: string
        }
        Insert: {
          attendance_at?: number
          charge_amount_at?: number
          charge_count_at?: number
          created_at?: string
          from_rank: Database["public"]["Enums"]["app_rank"]
          id?: string
          to_rank: Database["public"]["Enums"]["app_rank"]
          user_id: string
        }
        Update: {
          attendance_at?: number
          charge_amount_at?: number
          charge_count_at?: number
          created_at?: string
          from_rank?: Database["public"]["Enums"]["app_rank"]
          id?: string
          to_rank?: Database["public"]["Enums"]["app_rank"]
          user_id?: string
        }
        Relationships: []
      }
      rank_requirements: {
        Row: {
          label: string
          min_attendance: number
          min_charge_amount: number
          min_charge_count: number
          points_reward: number
          rank: Database["public"]["Enums"]["app_rank"]
          sort_order: number
        }
        Insert: {
          label: string
          min_attendance?: number
          min_charge_amount?: number
          min_charge_count?: number
          points_reward?: number
          rank: Database["public"]["Enums"]["app_rank"]
          sort_order: number
        }
        Update: {
          label?: string
          min_attendance?: number
          min_charge_amount?: number
          min_charge_count?: number
          points_reward?: number
          rank?: Database["public"]["Enums"]["app_rank"]
          sort_order?: number
        }
        Relationships: []
      }
      rank_reward_claims: {
        Row: {
          claimed_at: string
          id: string
          items_reward: Json
          points_reward: number
          rank: Database["public"]["Enums"]["app_rank"]
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          items_reward?: Json
          points_reward?: number
          rank: Database["public"]["Enums"]["app_rank"]
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          items_reward?: Json
          points_reward?: number
          rank?: Database["public"]["Enums"]["app_rank"]
          user_id?: string
        }
        Relationships: []
      }
      ranking_rewards: {
        Row: {
          id: string
          paid_at: string
          rank_position: number
          ranking_type: string
          reward_amount: number
          reward_meta: Json
          reward_type: string
          season_id: string
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          paid_at?: string
          rank_position: number
          ranking_type: string
          reward_amount?: number
          reward_meta?: Json
          reward_type: string
          season_id: string
          status?: string
          user_id: string
        }
        Update: {
          id?: string
          paid_at?: string
          rank_position?: number
          ranking_type?: string
          reward_amount?: number
          reward_meta?: Json
          reward_type?: string
          season_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_rewards_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      rare_item_offers: {
        Row: {
          bidder_user_id: string
          created_at: string
          expires_at: string
          id: string
          item_id: string
          message: string | null
          offer_amount: number
          owner_user_id: string
          responded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bidder_user_id: string
          created_at?: string
          expires_at?: string
          id?: string
          item_id: string
          message?: string | null
          offer_amount: number
          owner_user_id: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bidder_user_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          item_id?: string
          message?: string | null
          offer_amount?: number
          owner_user_id?: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rare_item_offers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          admin_note: string | null
          category: string
          content: string
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          reporter_id: string
          room_id: string | null
          round_id: string | null
          status: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          category?: string
          content: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reporter_id: string
          room_id?: string | null
          round_id?: string | null
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          content?: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          reporter_id?: string
          room_id?: string | null
          round_id?: string | null
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      room_event_logs: {
        Row: {
          action_id: string | null
          after_state: Json
          amount: number | null
          before_state: Json
          error_code: string | null
          event_type: string
          id: string
          nickname: string | null
          occurred_at: string
          pot_after: number | null
          pot_before: number | null
          room_id: string | null
          room_number: number
          round_id: string | null
          seat: number | null
          server_result: string | null
          user_id: string | null
        }
        Insert: {
          action_id?: string | null
          after_state?: Json
          amount?: number | null
          before_state?: Json
          error_code?: string | null
          event_type: string
          id?: string
          nickname?: string | null
          occurred_at?: string
          pot_after?: number | null
          pot_before?: number | null
          room_id?: string | null
          room_number: number
          round_id?: string | null
          seat?: number | null
          server_result?: string | null
          user_id?: string | null
        }
        Update: {
          action_id?: string | null
          after_state?: Json
          amount?: number | null
          before_state?: Json
          error_code?: string | null
          event_type?: string
          id?: string
          nickname?: string | null
          occurred_at?: string
          pot_after?: number | null
          pot_before?: number | null
          room_id?: string | null
          room_number?: number
          round_id?: string | null
          seat?: number | null
          server_result?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      room_types: {
        Row: {
          active: boolean
          allow_sutda2: boolean
          allow_sutda3: boolean
          base_bet: number
          created_at: string
          id: string
          max_players: number
          min_points: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allow_sutda2?: boolean
          allow_sutda3?: boolean
          base_bet: number
          created_at?: string
          id: string
          max_players?: number
          min_points: number
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allow_sutda2?: boolean
          allow_sutda3?: boolean
          base_bet?: number
          created_at?: string
          id?: string
          max_players?: number
          min_points?: number
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      season_rankings: {
        Row: {
          id: string
          losses: number
          rank_points: number
          season_id: string
          user_id: string
          wins: number
        }
        Insert: {
          id?: string
          losses?: number
          rank_points?: number
          season_id: string
          user_id: string
          wins?: number
        }
        Update: {
          id?: string
          losses?: number
          rank_points?: number
          season_id?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_rankings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          end_at: string | null
          id: string
          name: string
          rewards: Json
          start_at: string
          status: string
        }
        Insert: {
          end_at?: string | null
          id?: string
          name: string
          rewards?: Json
          start_at?: string
          status?: string
        }
        Update: {
          end_at?: string | null
          id?: string
          name?: string
          rewards?: Json
          start_at?: string
          status?: string
        }
        Relationships: []
      }
      signup_failure_logs: {
        Row: {
          created_at: string
          detail: Json
          error_code: string | null
          error_message: string | null
          id: string
          stage: string
          username: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          error_code?: string | null
          error_message?: string | null
          id?: string
          stage: string
          username?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          error_code?: string | null
          error_message?: string | null
          id?: string
          stage?: string
          username?: string | null
        }
        Relationships: []
      }
      telegram_links: {
        Row: {
          last_login_at: string | null
          linked_at: string
          telegram_first_name: string | null
          telegram_user_id: number
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          last_login_at?: string | null
          linked_at?: string
          telegram_first_name?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          user_id: string
        }
        Update: {
          last_login_at?: string | null
          linked_at?: string
          telegram_first_name?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: []
      }
      test_pot_reports: {
        Row: {
          case_key: string
          created_at: string
          id: string
          report: Json
          round_id: string
        }
        Insert: {
          case_key: string
          created_at?: string
          id?: string
          report: Json
          round_id: string
        }
        Update: {
          case_key?: string
          created_at?: string
          id?: string
          report?: Json
          round_id?: string
        }
        Relationships: []
      }
      test_sound_events: {
        Row: {
          client_session: string
          game_action_id: string | null
          id: string
          played_at: string
          result_event_id: string | null
          round_id: string | null
          sound_key: string
          sound_type: string
          user_id: string | null
        }
        Insert: {
          client_session: string
          game_action_id?: string | null
          id?: string
          played_at?: string
          result_event_id?: string | null
          round_id?: string | null
          sound_key: string
          sound_type: string
          user_id?: string | null
        }
        Update: {
          client_session?: string
          game_action_id?: string | null
          id?: string
          played_at?: string
          result_event_id?: string | null
          round_id?: string | null
          sound_key?: string
          sound_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          id?: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_attendance: {
        Row: {
          attend_date: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          attend_date: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          attend_date?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_effect_settings: {
        Row: {
          entry_effect: boolean
          name_effect: boolean
          reduce_others: boolean
          showdown_effect: boolean
          updated_at: string
          user_id: string
          win_effect: boolean
        }
        Insert: {
          entry_effect?: boolean
          name_effect?: boolean
          reduce_others?: boolean
          showdown_effect?: boolean
          updated_at?: string
          user_id: string
          win_effect?: boolean
        }
        Update: {
          entry_effect?: boolean
          name_effect?: boolean
          reduce_others?: boolean
          showdown_effect?: boolean
          updated_at?: string
          user_id?: string
          win_effect?: boolean
        }
        Relationships: []
      }
      user_items: {
        Row: {
          acquired_at: string
          equipped: boolean
          equipped_at: string | null
          expires_at: string | null
          id: string
          item_id: string
          source_rank: Database["public"]["Enums"]["app_rank"] | null
          source_type: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          equipped?: boolean
          equipped_at?: string | null
          expires_at?: string | null
          id?: string
          item_id: string
          source_rank?: Database["public"]["Enums"]["app_rank"] | null
          source_type?: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          equipped?: boolean
          equipped_at?: string | null
          expires_at?: string | null
          id?: string
          item_id?: string
          source_rank?: Database["public"]["Enums"]["app_rank"] | null
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_deposit_stats: {
        Row: {
          charge_amount: number
          charge_count: number
          id: string
          last_event_at: string | null
          net_deposit: number
          rank_position: number | null
          season_id: string
          user_id: string
          withdraw_amount: number
        }
        Insert: {
          charge_amount?: number
          charge_count?: number
          id?: string
          last_event_at?: string | null
          net_deposit?: number
          rank_position?: number | null
          season_id: string
          user_id: string
          withdraw_amount?: number
        }
        Update: {
          charge_amount?: number
          charge_count?: number
          id?: string
          last_event_at?: string | null
          net_deposit?: number
          rank_position?: number | null
          season_id?: string
          user_id?: string
          withdraw_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_deposit_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_gwang_stats: {
        Row: {
          games_played: number
          gwang13_wins: number
          gwang18_wins: number
          gwang38_wins: number
          id: string
          last_gwang_at: string | null
          rank_position: number | null
          season_id: string
          total_gwang_wins: number
          user_id: string
        }
        Insert: {
          games_played?: number
          gwang13_wins?: number
          gwang18_wins?: number
          gwang38_wins?: number
          id?: string
          last_gwang_at?: string | null
          rank_position?: number | null
          season_id: string
          total_gwang_wins?: number
          user_id: string
        }
        Update: {
          games_played?: number
          gwang13_wins?: number
          gwang18_wins?: number
          gwang38_wins?: number
          id?: string
          last_gwang_at?: string | null
          rank_position?: number | null
          season_id?: string
          total_gwang_wins?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_gwang_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_profit_stats: {
        Row: {
          games_played: number
          id: string
          last_win_at: string | null
          rank_position: number | null
          season_id: string
          user_id: string
          win_count: number
          win_points: number
        }
        Insert: {
          games_played?: number
          id?: string
          last_win_at?: string | null
          rank_position?: number | null
          season_id: string
          user_id: string
          win_count?: number
          win_points?: number
        }
        Update: {
          games_played?: number
          id?: string
          last_win_at?: string | null
          rank_position?: number | null
          season_id?: string
          user_id?: string
          win_count?: number
          win_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_profit_stats_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_ranking_seasons: {
        Row: {
          created_at: string
          deposit_participants: number
          ends_at: string
          finalized_at: string | null
          gwang_participants: number
          id: string
          profit_participants: number
          reward_rate: number
          rewarded_at: string | null
          starts_at: string
          status: string
          total_charge_amount: number
          updated_at: string
          week_key: string
        }
        Insert: {
          created_at?: string
          deposit_participants?: number
          ends_at: string
          finalized_at?: string | null
          gwang_participants?: number
          id?: string
          profit_participants?: number
          reward_rate?: number
          rewarded_at?: string | null
          starts_at: string
          status?: string
          total_charge_amount?: number
          updated_at?: string
          week_key: string
        }
        Update: {
          created_at?: string
          deposit_participants?: number
          ends_at?: string
          finalized_at?: string | null
          gwang_participants?: number
          id?: string
          profit_participants?: number
          reward_rate?: number
          rewarded_at?: string | null
          starts_at?: string
          status?: string
          total_charge_amount?: number
          updated_at?: string
          week_key?: string
        }
        Relationships: []
      }
      withdrawal_request_logs: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string
          withdrawal_request_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status: string
          withdrawal_request_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string
          withdrawal_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_request_logs_withdrawal_request_id_fkey"
            columns: ["withdrawal_request_id"]
            isOneToOne: false
            referencedRelation: "withdrawal_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          admin_note: string | null
          conversion_rate: number
          id: string
          payout_amount: number
          payout_details: Json
          payout_method: string
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          requested_points: number
          status: string
          user_id: string
          user_note: string | null
        }
        Insert: {
          admin_note?: string | null
          conversion_rate: number
          id?: string
          payout_amount: number
          payout_details?: Json
          payout_method: string
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          requested_points: number
          status?: string
          user_id: string
          user_note?: string | null
        }
        Update: {
          admin_note?: string | null
          conversion_rate?: number
          id?: string
          payout_amount?: number
          payout_details?: Json
          payout_method?: string
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          requested_points?: number
          status?: string
          user_id?: string
          user_note?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      actionable_betting_count: { Args: { _round_id: string }; Returns: number }
      admin_abandoned_rounds: {
        Args: { _min_idle_minutes?: number }
        Returns: Json
      }
      admin_adjust_points: {
        Args: { _amount: number; _memo?: string; _user_id: string }
        Returns: undefined
      }
      admin_adjust_points_v2: {
        Args: {
          _amount: number
          _direction: string
          _reason: string
          _request_id: string
          _user_id: string
        }
        Returns: Json
      }
      admin_cancel_abandoned_round: {
        Args: { _reason: string; _round_id: string }
        Returns: Json
      }
      admin_cancel_crypto_deposit: {
        Args: { _deposit_id: string; _reason: string; _request_id: string }
        Returns: Json
      }
      admin_chat_ban_user: {
        Args: { _hours: number; _reason: string; _user_id: string }
        Returns: Json
      }
      admin_cleanup_test_data: { Args: { _reason?: string }; Returns: Json }
      admin_clear_sanction: {
        Args: { _kind: string; _reason: string; _user_id: string }
        Returns: Json
      }
      admin_correct_locked_points: {
        Args: { _locked: number; _reason: string; _user_id: string }
        Returns: Json
      }
      admin_critical_alerts: { Args: { _scope?: string }; Returns: Json }
      admin_crypto_feed: { Args: { _limit?: number }; Returns: Json }
      admin_crypto_overview: { Args: never; Returns: Json }
      admin_crypto_preflight: { Args: never; Returns: Json }
      admin_dashboard_overview: { Args: never; Returns: Json }
      admin_delete_item: {
        Args: { _id: string; _reason: string }
        Returns: string
      }
      admin_delete_notice: { Args: { _id: string }; Returns: undefined }
      admin_disable_custom_profile: {
        Args: { _reason: string; _user_id: string }
        Returns: Json
      }
      admin_disable_custom_title: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      admin_finalize_weekly_season: {
        Args: { _season_id: string }
        Returns: undefined
      }
      admin_find_user_by_username: {
        Args: { _username: string }
        Returns: string
      }
      admin_force_delete_room: {
        Args: {
          _reason: string
          _room_id: string
          _room_number_confirm: number
        }
        Returns: Json
      }
      admin_global_search: { Args: { _q: string }; Returns: Json }
      admin_grant_item: {
        Args: { _item_id: string; _reason?: string; _user_id: string }
        Returns: undefined
      }
      admin_handle_report: {
        Args: { _admin_note?: string; _report_id: string; _status: string }
        Returns: undefined
      }
      admin_integrity_card_check: { Args: never; Returns: Json }
      admin_integrity_report: { Args: never; Returns: Json }
      admin_list_admins: {
        Args: never
        Returns: {
          created_at: string
          last_login_at: string
          nickname: string
          role: string
          status: string
          user_id: string
          username: string
        }[]
      }
      admin_list_affiliates: { Args: never; Returns: Json }
      admin_list_crypto_unmatched: {
        Args: { _limit?: number; _status?: string }
        Returns: Json
      }
      admin_list_custom_profiles: { Args: { _status?: string }; Returns: Json }
      admin_list_custom_titles: { Args: { _status?: string }; Returns: Json }
      admin_list_integrity_findings: {
        Args: { _scope?: string; _status?: string }
        Returns: Json
      }
      admin_list_members: {
        Args: { _limit?: number; _search?: string }
        Returns: Json
      }
      admin_list_rooms: {
        Args: { _filter?: string; _limit?: number; _search?: string }
        Returns: Json
      }
      admin_list_withdrawals: {
        Args: { _limit?: number }
        Returns: {
          address: string
          admin_note: string
          conversion_rate: number
          expected_usdt: number
          id: string
          krw_per_usdt: number
          network: string
          nickname: string
          payout_amount: number
          payout_method: string
          processed_at: string
          requested_at: string
          requested_points: number
          status: string
          user_id: string
          user_note: string
          username: string
        }[]
      }
      admin_log_event: {
        Args: { _action: string; _metadata?: Json }
        Returns: undefined
      }
      admin_manual_credit_crypto_deposit: {
        Args: { _deposit_id: string; _reason: string; _request_id: string }
        Returns: Json
      }
      admin_manual_credit_orphan_deposit: {
        Args: { _deposit_id: string; _reason: string; _user_id: string }
        Returns: Json
      }
      admin_member_contact: { Args: { _user_id: string }; Returns: Json }
      admin_pay_weekly_rewards: { Args: { _season_id: string }; Returns: Json }
      admin_process_charge: {
        Args: { _admin_note?: string; _request_id: string; _status: string }
        Returns: undefined
      }
      admin_process_withdrawal: {
        Args: { _admin_note?: string; _request_id: string; _status: string }
        Returns: undefined
      }
      admin_recalc_season_rankings: { Args: never; Returns: number }
      admin_recalc_weekly_season: {
        Args: { _reason?: string; _season_id: string }
        Returns: Json
      }
      admin_recent_activity: { Args: { _limit?: number }; Returns: Json }
      admin_release_closed_room_seats: { Args: never; Returns: Json }
      admin_room_logs: {
        Args: {
          _event_type?: string
          _from?: string
          _limit?: number
          _room_number?: number
          _round_id?: string
          _to?: string
          _user_search?: string
        }
        Returns: Json
      }
      admin_room_snapshot: { Args: { _room_id: string }; Returns: Json }
      admin_safe_close_room: {
        Args: { _reason: string; _room_id: string }
        Returns: Json
      }
      admin_scan_integrity_findings: { Args: never; Returns: Json }
      admin_search_logs: {
        Args: {
          _action?: string
          _admin_search?: string
          _from?: string
          _limit?: number
          _target_search?: string
          _to?: string
        }
        Returns: Json
      }
      admin_search_members: {
        Args: { _limit?: number; _q: string }
        Returns: Json
      }
      admin_server_status: { Args: never; Returns: Json }
      admin_service_readiness: { Args: never; Returns: Json }
      admin_set_affiliate: {
        Args: { _code?: string; _memo?: string; _user_id: string }
        Returns: string
      }
      admin_set_affiliate_rebate_rate: {
        Args: { _affiliate_id: string; _rate: number; _reason?: string }
        Returns: Json
      }
      admin_set_affiliate_status: {
        Args: { _affiliate_id: string; _status: string }
        Returns: undefined
      }
      admin_set_commission_status: {
        Args: { _commission_id: string; _reason?: string; _status: string }
        Returns: undefined
      }
      admin_set_custom_profile_expiry: {
        Args: { _expires_at: string; _user_id: string }
        Returns: Json
      }
      admin_set_finding_status: {
        Args: { _finding_id: string; _reason: string; _status: string }
        Returns: Json
      }
      admin_set_item_status: {
        Args: { _id: string; _reason?: string; _status: string }
        Returns: undefined
      }
      admin_set_permissions: {
        Args: { _permissions: string[]; _reason?: string; _user_id: string }
        Returns: undefined
      }
      admin_set_risk_level: {
        Args: { _level: string; _note?: string; _user_id: string }
        Returns: undefined
      }
      admin_set_role: {
        Args: { _reason?: string; _role: string; _user_id: string }
        Returns: undefined
      }
      admin_set_season_status: {
        Args: { _season_id: string; _status: string }
        Returns: undefined
      }
      admin_set_test_room: {
        Args: { _is_test: boolean; _reason?: string; _room_id: string }
        Returns: undefined
      }
      admin_set_test_user: {
        Args: { _is_test: boolean; _reason?: string; _user_id: string }
        Returns: undefined
      }
      admin_set_user_level: {
        Args: { _level: number; _reason?: string; _user_id: string }
        Returns: undefined
      }
      admin_set_user_status: {
        Args: { _reason?: string; _status: string; _user_id: string }
        Returns: undefined
      }
      admin_suspend_user: {
        Args: { _days: number; _reason: string; _user_id: string }
        Returns: Json
      }
      admin_update_card_asset: {
        Args: {
          _asset_url: string
          _enabled: boolean
          _id: string
          _is_gwang?: boolean
        }
        Returns: undefined
      }
      admin_update_crypto_settings: {
        Args: { _patch: Json; _reason: string }
        Returns: Json
      }
      admin_update_member_contact: {
        Args: {
          _reason: string
          _telegram_id: string
          _user_id: string
          _wallet_address: string
        }
        Returns: undefined
      }
      admin_update_member_profile: {
        Args: {
          _affiliate_id?: string
          _nickname?: string
          _rank?: string
          _reason?: string
          _status?: string
          _telegram_id?: string
          _user_id: string
          _username?: string
          _wallet_address?: string
        }
        Returns: Json
      }
      admin_update_rank_requirement: {
        Args: {
          _min_attendance: number
          _min_charge_amount: number
          _min_charge_count: number
          _points_reward: number
          _rank: string
          _reason: string
        }
        Returns: undefined
      }
      admin_update_room_type: {
        Args: {
          _active: boolean
          _allow_sutda2: boolean
          _allow_sutda3: boolean
          _base_bet: number
          _id: string
          _max_players: number
          _min_points: number
        }
        Returns: undefined
      }
      admin_update_setting: {
        Args: { _key: string; _value: Json }
        Returns: undefined
      }
      admin_update_settings: {
        Args: { _reason?: string; _values: Json }
        Returns: Json
      }
      admin_upsert_item: {
        Args: {
          _asset_url: string
          _category: string
          _description: string
          _duration_days?: number
          _id: string
          _images: Json
          _name: string
          _price: number
          _rarity: string
          _reason?: string
          _sort_order: number
          _status: string
        }
        Returns: string
      }
      admin_upsert_notice: {
        Args: {
          _body: string
          _category: string
          _ends_at?: string
          _id: string
          _pinned: boolean
          _published: boolean
          _starts_at?: string
          _title: string
        }
        Returns: string
      }
      advance_round_state: { Args: { _round_id: string }; Returns: Json }
      affiliate_commission_is_settled: {
        Args: { _status: string }
        Returns: boolean
      }
      affiliate_commission_is_unsettled: {
        Args: { _status: string }
        Returns: boolean
      }
      affiliate_overview: { Args: { _affiliate_id?: string }; Returns: Json }
      angel_finalize_empty_room: {
        Args: { _room_id: string }
        Returns: boolean
      }
      apply_contextual_rules: {
        Args: { _codes: Json; _scores: Json }
        Returns: Json
      }
      assert_round_start_allowed: { Args: never; Returns: undefined }
      bet_additional_amount: {
        Args: {
          _action_type: string
          _balance: number
          _base_bet: number
          _current_bet: number
          _pot: number
          _stage_bet: number
        }
        Returns: number
      }
      bootstrap_super_admin: { Args: never; Returns: string }
      build_side_pots: { Args: { _round_id: string }; Returns: Json }
      cancel_leave_room: { Args: { _room_id: string }; Returns: undefined }
      cancel_my_charge_request: {
        Args: { _request_id: string }
        Returns: undefined
      }
      cancel_my_crypto_charge: { Args: { _id: string }; Returns: Json }
      cancel_rare_offer: { Args: { _offer_id: string }; Returns: undefined }
      claim_daily_attendance: { Args: never; Returns: Json }
      cleanup_empty_rooms: { Args: never; Returns: number }
      close_or_hold_room: { Args: { _room_id: string }; Returns: string }
      complete_sutda2_first_betting: {
        Args: { _round_id: string }
        Returns: Json
      }
      confirm_card_squeeze: { Args: { _round_id: string }; Returns: Json }
      create_crypto_charge_request: {
        Args: { _krw: number; _rate: number }
        Returns: Json
      }
      create_rare_offer: {
        Args: { _item_id: string; _message?: string; _offer_amount: number }
        Returns: string
      }
      credit_crypto_charge: {
        Args: {
          _allow_amount_mismatch?: boolean
          _deposit_id: string
          _override_krw?: number
          _request_id: string
        }
        Returns: Json
      }
      crypto_preflight_db: { Args: never; Returns: Json }
      crypto_scheduler_status: { Args: never; Returns: Json }
      crypto_setting_text: { Args: { _key: string }; Returns: string }
      crypto_watcher_begin: { Args: { _stale_seconds?: number }; Returns: Json }
      crypto_watcher_finish: { Args: { _stats: Json }; Returns: Json }
      custom_profile_images: { Args: { _user_ids: string[] }; Returns: Json }
      custom_title_available: { Args: { _title: string }; Returns: Json }
      deal_next_card: { Args: { _round_id: string }; Returns: number }
      dori_action_options: { Args: { _room_id: string }; Returns: Json }
      dori_actionable_betting_count: {
        Args: { _round_id: string }
        Returns: number
      }
      dori_admin_abort_round: { Args: { _room_id: string }; Returns: Json }
      dori_admin_list_rooms: {
        Args: { _include_closed?: boolean }
        Returns: Json
      }
      dori_admin_log: {
        Args: { _action: string; _metadata: Json; _target_id: string }
        Returns: undefined
      }
      dori_admin_room_detail: { Args: { _room_id: string }; Returns: Json }
      dori_admin_safe_close: {
        Args: { _force?: boolean; _room_id: string }
        Returns: Json
      }
      dori_advance: { Args: { _round_id: string }; Returns: undefined }
      dori_cleanup_room: { Args: { _room_id: string }; Returns: undefined }
      dori_create_room: {
        Args: {
          _ante?: number
          _is_private?: boolean
          _min_points?: number
          _password?: string
          _room_type?: string
          _title: string
        }
        Returns: string
      }
      dori_eval_pair: { Args: { _a: number; _b: number }; Returns: Json }
      dori_eval_pair_cards: {
        Args: { _c1: string; _c2: string }
        Returns: Json
      }
      dori_grade_preset: { Args: { _grade: string }; Returns: Json }
      dori_heartbeat: { Args: { _room_id: string }; Returns: undefined }
      dori_hwang: { Args: never; Returns: Json }
      dori_join_seat: {
        Args: { _password?: string; _room_id: string; _seat: number }
        Returns: number
      }
      dori_leave_room: { Args: { _room_id: string }; Returns: string }
      dori_list_rooms: {
        Args: never
        Returns: {
          ante: number
          id: string
          is_private: boolean
          max_players: number
          min_points: number
          phase: string
          room_number: number
          room_type: string
          seated: number
          status: string
          title: string
        }[]
      }
      dori_make_options: { Args: { _cards: string[] }; Returns: Json }
      dori_month: { Args: { _card: string }; Returns: number }
      dori_my_active_room: { Args: never; Returns: Json }
      dori_my_cards: { Args: { _room_id: string }; Returns: Json }
      dori_place_bet: {
        Args: { _action: string; _amount?: number; _room_id: string }
        Returns: Json
      }
      dori_reveal_choice: {
        Args: { _reveal: boolean; _round_id: string }
        Returns: Json
      }
      dori_reveal_mode: { Args: { _round_id: string }; Returns: string }
      dori_room_state: { Args: { _room_id: string }; Returns: Json }
      dori_round_history: {
        Args: { _limit?: number; _room_id: string }
        Returns: Json
      }
      dori_round_result: { Args: { _round_id: string }; Returns: Json }
      dori_seat_revealed: {
        Args: { _folded: boolean; _mode: string; _result_type: string }
        Returns: boolean
      }
      dori_set_ready: {
        Args: { _ready: boolean; _room_id: string }
        Returns: boolean
      }
      dori_settle_round: { Args: { _round_id: string }; Returns: undefined }
      dori_special_hand: { Args: { _c1: string; _c2: string }; Returns: Json }
      dori_start_round: { Args: { _room_id: string }; Returns: string }
      dori_submit_make: {
        Args: { _room_id: string; _selected: string[] }
        Returns: Json
      }
      dori_tick: { Args: { _room_id: string }; Returns: Json }
      dori_visible_cards: { Args: { _phase: string }; Returns: number }
      enforce_room_balance_eligibility: {
        Args: { _room_id: string }
        Returns: Json
      }
      enforce_room_min_balance: { Args: { _room_id: string }; Returns: Json }
      enforce_turn_timeout: { Args: { _round_id: string }; Returns: Json }
      ensure_weekly_season: {
        Args: never
        Returns: {
          created_at: string
          deposit_participants: number
          ends_at: string
          finalized_at: string | null
          gwang_participants: number
          id: string
          profit_participants: number
          reward_rate: number
          rewarded_at: string | null
          starts_at: string
          status: string
          total_charge_amount: number
          updated_at: string
          week_key: string
        }
        SetofOptions: {
          from: "*"
          to: "weekly_ranking_seasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      equip_custom_title: { Args: { _id: string }; Returns: undefined }
      equip_item: { Args: { _item_id: string }; Returns: undefined }
      equipped_item_asset: {
        Args: { _category: string; _user_id: string }
        Returns: Json
      }
      evaluate_member_rank: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_rank"]
      }
      evaluate_sutda_hand: { Args: { _c1: string; _c2: string }; Returns: Json }
      expire_crypto_charge_requests: { Args: never; Returns: number }
      expire_custom_profiles: { Args: never; Returns: undefined }
      expire_custom_titles: { Args: never; Returns: number }
      expire_disconnected_players: {
        Args: { _round_id: string }
        Returns: number
      }
      expire_my_items: { Args: never; Returns: number }
      expire_rare_item_offers: { Args: never; Returns: undefined }
      expire_user_items: { Args: { _user_id?: string }; Returns: number }
      game_heartbeat: { Args: { _room_id: string }; Returns: undefined }
      game_take_bet: {
        Args: { _amount: number; _round_id: string; _user_id: string }
        Returns: undefined
      }
      get_my_cards: {
        Args: { _round_id: string }
        Returns: {
          asset_url: string
          card_code: string
          card_order: number
          is_gwang: boolean
          month: number
        }[]
      }
      get_round_snapshot: { Args: { _round_id: string }; Returns: Json }
      get_round_state: { Args: { _round_id: string }; Returns: Json }
      grant_points_internal: {
        Args: {
          _admin?: string
          _amount: number
          _memo: string
          _ref_id?: string
          _ref_type?: string
          _type: string
          _user_id: string
        }
        Returns: undefined
      }
      grant_ranking_title_internal: {
        Args: { _effect_key: string; _user_id: string }
        Returns: boolean
      }
      gusa_best_other_score: {
        Args: { _codes: Json; _scores: Json; _self?: string }
        Returns: number
      }
      gusa_rematch_required: {
        Args: { _codes: Json; _scores: Json }
        Returns: boolean
      }
      has_admin_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ingest_chain_deposit: {
        Args: {
          _amount_atomic: number
          _block_number: number
          _block_timestamp: string
          _confirmations: number
          _from_address: string
          _to_address: string
          _token_contract: string
          _txid: string
        }
        Returns: Json
      }
      is_active_custom_profile_path: {
        Args: { _path: string }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_valid_tron_address: { Args: { _addr: string }; Returns: boolean }
      join_room: {
        Args: { _room_id: string; _spectator?: boolean }
        Returns: number
      }
      log_game_error: {
        Args: {
          _action?: string
          _error_code?: string
          _error_message: string
          _fn: string
          _metadata?: Json
          _phase?: string
          _retried?: boolean
          _room_id?: string
          _round_id?: string
        }
        Returns: undefined
      }
      log_room_event: {
        Args: {
          _action_id?: string
          _after?: Json
          _amount?: number
          _before?: Json
          _error_code?: string
          _event_type: string
          _pot_after?: number
          _pot_before?: number
          _room_id: string
          _round_id?: string
          _seat?: number
          _server_result?: string
          _user_id?: string
        }
        Returns: undefined
      }
      log_security_event: {
        Args: { _code: string; _detail?: Json }
        Returns: undefined
      }
      mark_disconnected: {
        Args: { _grace_seconds?: number; _room_id: string }
        Returns: undefined
      }
      my_active_game: {
        Args: never
        Returns: {
          game_mode: string
          room_id: string
          room_title: string
          round_id: string
          seat: number
        }[]
      }
      my_admin_role: { Args: never; Returns: string }
      my_custom_profile: { Args: never; Returns: Json }
      my_custom_titles: {
        Args: never
        Returns: {
          disabled_reason: string
          equipped: boolean
          expires_at: string
          id: string
          price: number
          purchased_at: string
          status: string
          title_text: string
        }[]
      }
      my_equipped_title: { Args: never; Returns: Json }
      my_profile: {
        Args: never
        Returns: {
          attendance_count: number
          avatar_url: string | null
          chat_banned_until: string | null
          created_at: string
          current_streak: number
          email: string | null
          exp: number
          game_points: number
          gwangttaeng_count: number
          id: string
          is_test_user: boolean
          last_seen_at: string
          level: number
          locked_points: number
          losses: number
          max_streak: number
          nickname: string
          rank: Database["public"]["Enums"]["app_rank"]
          rank_points: number
          referred_by_affiliate_id: string | null
          risk_level: string
          risk_note: string | null
          sanction_reason: string | null
          signup_code_used: string | null
          status: string
          suspended_until: string | null
          telegram_id: string | null
          total_charge_amount: number
          total_charge_count: number
          username: string | null
          wallet_address: string | null
          wins: number
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_rare_offers: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          id: string
          item_id: string
          item_name: string
          message: string
          offer_amount: number
          responded_at: string
          status: string
        }[]
      }
      normalize_custom_title: { Args: { _t: string }; Returns: string }
      official_channel_link: { Args: never; Returns: string }
      ops_flag: { Args: { _key: string }; Returns: boolean }
      ops_status: { Args: never; Returns: Json }
      place_action: {
        Args: {
          _action_id: string
          _action_type: string
          _amount: number
          _round_id: string
          _turn_number: number
        }
        Returns: number
      }
      place_bet_action: {
        Args: { _action_id: string; _action_type: string; _round_id: string }
        Returns: Json
      }
      process_leave_pending: { Args: { _room_id: string }; Returns: number }
      purchase_custom_profile: { Args: { _request_id?: string }; Returns: Json }
      purchase_custom_title: {
        Args: { _request_id?: string; _title: string }
        Returns: Json
      }
      purchase_item: { Args: { _item_id: string }; Returns: undefined }
      rare_item_owners: {
        Args: never
        Returns: {
          item_id: string
          owner_is_me: boolean
          owner_nickname: string
        }[]
      }
      received_rare_offers: {
        Args: never
        Returns: {
          bidder_nickname: string
          created_at: string
          expires_at: string
          id: string
          item_id: string
          item_name: string
          message: string
          offer_amount: number
          responded_at: string
          status: string
        }[]
      }
      request_charge_with_ticket: {
        Args: {
          _amount: number
          _depositor_name: string
          _note?: string
          _use_ticket?: boolean
        }
        Returns: string
      }
      request_leave_room: { Args: { _room_id: string }; Returns: string }
      request_withdrawal: {
        Args: {
          _details: Json
          _method: string
          _note?: string
          _points: number
        }
        Returns: string
      }
      resolve_fold_win_reveal: { Args: { _round_id: string }; Returns: Json }
      respond_rare_offer: {
        Args: { _decision: string; _offer_id: string }
        Returns: undefined
      }
      room_loadouts: { Args: { _room_id: string }; Returns: Json }
      room_table_state: { Args: { _room_id: string }; Returns: Json }
      round_player_hand: {
        Args: { _round_id: string; _user_id: string }
        Returns: Json
      }
      run_crypto_watcher_cron: { Args: never; Returns: number }
      select_final_hand: {
        Args: { _card1: string; _card2: string; _round_id: string }
        Returns: Json
      }
      select_open_card: {
        Args: { _card: string; _round_id: string }
        Returns: Json
      }
      select_seat: {
        Args: { _room_id: string; _seat: number }
        Returns: number
      }
      seoul_week_key: { Args: { _ts?: string }; Returns: string }
      seoul_week_start: { Args: { _ts?: string }; Returns: string }
      set_cron_secret_vault: { Args: { _secret: string }; Returns: string }
      set_custom_profile_image: {
        Args: {
          _bytes: number
          _height: number
          _mime: string
          _path: string
          _width: number
        }
        Returns: Json
      }
      set_fold_win_reveal: {
        Args: { _reveal: boolean; _round_id: string }
        Returns: Json
      }
      set_room_ready: {
        Args: { _ready: boolean; _room_id: string }
        Returns: Json
      }
      settle_round: { Args: { _round_id: string }; Returns: Json }
      settle_round_without_phase_guard: {
        Args: { _round_id: string }
        Returns: Json
      }
      start_game_round: { Args: { _room_id: string }; Returns: string }
      super_admin_exists: { Args: never; Returns: boolean }
      support_center_link: { Args: never; Returns: string }
      sutda_best_pair: { Args: { _cards: string[] }; Returns: Json }
      sutda_card_is_gwang: { Args: { _code: string }; Returns: boolean }
      sutda_card_month: { Args: { _code: string }; Returns: number }
      sutda_is_pair: {
        Args: { _c1: string; _c2: string; _pair: Json }
        Returns: boolean
      }
      sutda_round_result: { Args: { _round_id: string }; Returns: Json }
      sutda_special_cards: { Args: never; Returns: Json }
      sync_my_rank: {
        Args: never
        Returns: Database["public"]["Enums"]["app_rank"]
      }
      test_driver_assert: { Args: { _room_id: string }; Returns: undefined }
      test_log_sound_event: {
        Args: {
          _client_session: string
          _game_action_id?: string
          _result_event_id?: string
          _round_id?: string
          _sound_key: string
          _sound_type: string
        }
        Returns: Json
      }
      test_pot_report: {
        Args: { _case_key: string; _round_id: string }
        Returns: Json
      }
      test_seed_round_cards: {
        Args: { _map: Json; _round_id: string }
        Returns: Json
      }
      test_set_points: {
        Args: { _points: number; _user_id: string }
        Returns: Json
      }
      transition_game_round_phase: {
        Args: { _expected: string; _next: string; _round_id: string }
        Returns: boolean
      }
      unequip_category: { Args: { _category: string }; Returns: undefined }
      username_available: { Args: { _username: string }; Returns: boolean }
      validate_custom_title: { Args: { _title: string }; Returns: Json }
      weekly_deposit_ranking: {
        Args: { _limit?: number; _season_id: string }
        Returns: {
          charge_amount: number
          charge_count: number
          last_event_at: string
          net_deposit: number
          nickname: string
          rank: Database["public"]["Enums"]["app_rank"]
          rank_position: number
          user_id: string
          withdraw_amount: number
        }[]
      }
      weekly_gwang_ranking: {
        Args: { _limit?: number; _season_id: string }
        Returns: {
          games_played: number
          gwang13_wins: number
          gwang18_wins: number
          gwang38_wins: number
          last_gwang_at: string
          nickname: string
          rank: Database["public"]["Enums"]["app_rank"]
          rank_position: number
          total_gwang_wins: number
          user_id: string
        }[]
      }
      weekly_profit_ranking: {
        Args: { _limit?: number; _season_id: string }
        Returns: {
          games_played: number
          last_win_at: string
          nickname: string
          rank: Database["public"]["Enums"]["app_rank"]
          rank_position: number
          user_id: string
          win_count: number
          win_points: number
        }[]
      }
    }
    Enums: {
      app_rank:
        | "UNRANKED"
        | "BRONZE"
        | "SILVER"
        | "GOLD"
        | "DIAMOND"
        | "CHALLENGER"
      app_role: "user" | "admin" | "super_admin" | "affiliate"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_rank: [
        "UNRANKED",
        "BRONZE",
        "SILVER",
        "GOLD",
        "DIAMOND",
        "CHALLENGER",
      ],
      app_role: ["user", "admin", "super_admin", "affiliate"],
    },
  },
} as const
