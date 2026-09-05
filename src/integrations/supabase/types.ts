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
      account_reconciliations: {
        Row: {
          account_id: string
          actual_balance: number
          created_at: string | null
          delta: number
          effective_date: string
          id: string
          projected_balance: number
          source_table: string
          user_id: string
        }
        Insert: {
          account_id: string
          actual_balance: number
          created_at?: string | null
          delta: number
          effective_date: string
          id?: string
          projected_balance: number
          source_table: string
          user_id: string
        }
        Update: {
          account_id?: string
          actual_balance?: number
          created_at?: string | null
          delta?: number
          effective_date?: string
          id?: string
          projected_balance?: number
          source_table?: string
          user_id?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          account_type: string
          active: boolean
          annual_fee: number | null
          annual_fee_date: string | null
          apr: number | null
          apr_plaid_synced: boolean | null
          apr_start_date: string | null
          apy_rate: number | null
          balance: number
          balance_tranches: Json | null
          card_start_date: string | null
          connection_id: string | null
          created_at: string
          credit_limit: number | null
          id: string
          installment_balance: number | null
          installment_monthly_payment: number | null
          institution: string
          liability_synced_at: string | null
          min_payment: number | null
          min_payment_is_manual: boolean
          min_payment_plaid_synced: boolean | null
          name: string
          name_is_manual: boolean
          notes: string | null
          payment_due_day: number | null
          payment_preference: string | null
          plaid_account_id: string | null
          plaid_item_id: string | null
          provider: string
          sort_order: number
          statement_balance: number | null
          statement_balance_phase: boolean
          surplus_share: number | null
          surplus_sort_order: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string
          active?: boolean
          annual_fee?: number | null
          annual_fee_date?: string | null
          apr?: number | null
          apr_plaid_synced?: boolean | null
          apr_start_date?: string | null
          apy_rate?: number | null
          balance?: number
          balance_tranches?: Json | null
          card_start_date?: string | null
          connection_id?: string | null
          created_at?: string
          credit_limit?: number | null
          id?: string
          installment_balance?: number | null
          installment_monthly_payment?: number | null
          institution?: string
          liability_synced_at?: string | null
          min_payment?: number | null
          min_payment_is_manual?: boolean
          min_payment_plaid_synced?: boolean | null
          name: string
          name_is_manual?: boolean
          notes?: string | null
          payment_due_day?: number | null
          payment_preference?: string | null
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          provider?: string
          sort_order?: number
          statement_balance?: number | null
          statement_balance_phase?: boolean
          surplus_share?: number | null
          surplus_sort_order?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          active?: boolean
          annual_fee?: number | null
          annual_fee_date?: string | null
          apr?: number | null
          apr_plaid_synced?: boolean | null
          apr_start_date?: string | null
          apy_rate?: number | null
          balance?: number
          balance_tranches?: Json | null
          card_start_date?: string | null
          connection_id?: string | null
          created_at?: string
          credit_limit?: number | null
          id?: string
          installment_balance?: number | null
          installment_monthly_payment?: number | null
          institution?: string
          liability_synced_at?: string | null
          min_payment?: number | null
          min_payment_is_manual?: boolean
          min_payment_plaid_synced?: boolean | null
          name?: string
          name_is_manual?: boolean
          notes?: string | null
          payment_due_day?: number | null
          payment_preference?: string | null
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          provider?: string
          sort_order?: number
          statement_balance?: number | null
          statement_balance_phase?: boolean
          surplus_share?: number | null
          surplus_sort_order?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "financial_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      achievements: {
        Row: {
          achievement_id: string
          created_at: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          created_at?: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          created_at?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_advisor_history: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          question: string | null
          result: Json
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          question?: string | null
          result: Json
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          question?: string | null
          result?: Json
          user_id?: string
        }
        Relationships: []
      }
      ai_usage_events: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          type: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          type?: string
          updated_at?: string
          user_id: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      budget_items: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      capital_contributions: {
        Row: {
          account: string
          amount: number
          created_at: string
          currency: string
          date: string
          entry_type: string
          id: string
          notes: string | null
          reporting_year: number | null
          source: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          account?: string
          amount: number
          created_at?: string
          currency?: string
          date: string
          entry_type?: string
          id?: string
          notes?: string | null
          reporting_year?: number | null
          source?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          account?: string
          amount?: number
          created_at?: string
          currency?: string
          date?: string
          entry_type?: string
          id?: string
          notes?: string | null
          reporting_year?: number | null
          source?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      car_build_items: {
        Row: {
          brand: string | null
          build_id: string
          completed: boolean
          created_at: string
          id: string
          link: string | null
          name: string
          payment_plan_id: string | null
          phase_id: string
          price: number | null
          sort_order: number
          user_id: string
        }
        Insert: {
          brand?: string | null
          build_id: string
          completed?: boolean
          created_at?: string
          id?: string
          link?: string | null
          name: string
          payment_plan_id?: string | null
          phase_id: string
          price?: number | null
          sort_order?: number
          user_id: string
        }
        Update: {
          brand?: string | null
          build_id?: string
          completed?: boolean
          created_at?: string
          id?: string
          link?: string | null
          name?: string
          payment_plan_id?: string | null
          phase_id?: string
          price?: number | null
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_build_items_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "car_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_build_items_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_build_items_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "car_build_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      car_build_phases: {
        Row: {
          build_id: string
          created_at: string
          hidden: boolean
          id: string
          sort_order: number
          title: string
          user_id: string
        }
        Insert: {
          build_id: string
          created_at?: string
          hidden?: boolean
          id?: string
          sort_order?: number
          title: string
          user_id: string
        }
        Update: {
          build_id?: string
          created_at?: string
          hidden?: boolean
          id?: string
          sort_order?: number
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_build_phases_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "car_builds"
            referencedColumns: ["id"]
          },
        ]
      }
      car_builds: {
        Row: {
          car_fund_id: string | null
          created_at: string
          id: string
          maintenance_public: boolean
          make: string | null
          model: string | null
          name: string
          notes: string | null
          photos: Json | null
          pricing_public: boolean
          share_token: string | null
          sort_order: number
          user_id: string
          year: number | null
        }
        Insert: {
          car_fund_id?: string | null
          created_at?: string
          id?: string
          maintenance_public?: boolean
          make?: string | null
          model?: string | null
          name: string
          notes?: string | null
          photos?: Json | null
          pricing_public?: boolean
          share_token?: string | null
          sort_order?: number
          user_id: string
          year?: number | null
        }
        Update: {
          car_fund_id?: string | null
          created_at?: string
          id?: string
          maintenance_public?: boolean
          make?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          photos?: Json | null
          pricing_public?: boolean
          share_token?: string | null
          sort_order?: number
          user_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "car_builds_car_fund_id_fkey"
            columns: ["car_fund_id"]
            isOneToOne: false
            referencedRelation: "car_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      car_funds: {
        Row: {
          actual_monthly_payment: number
          auto_extra: boolean
          auto_extra_auto_cleared: boolean
          created_at: string
          current_saved: number
          down_payment_goal: number
          expected_apr: number
          gift_contribution: number
          id: string
          insurance_start_date: string | null
          interest_start_date: string | null
          linked_account: string | null
          linked_loan_account_id: string | null
          linked_rule_id: string | null
          loan_amount: number
          loan_payment_account: string | null
          loan_start_date: string | null
          loan_term_months: number
          lump_sum_payments: Json
          monthly_insurance: number
          payment_start_date: string | null
          phase: string
          planned_purchase_date: string | null
          saved_percent: number
          saved_source: string
          sort_order: number
          surplus_share: number | null
          target_price: number
          tax_fees: number
          updated_at: string
          user_id: string
          vehicle_name: string
        }
        Insert: {
          actual_monthly_payment?: number
          auto_extra?: boolean
          auto_extra_auto_cleared?: boolean
          created_at?: string
          current_saved?: number
          down_payment_goal?: number
          expected_apr?: number
          gift_contribution?: number
          id?: string
          insurance_start_date?: string | null
          interest_start_date?: string | null
          linked_account?: string | null
          linked_loan_account_id?: string | null
          linked_rule_id?: string | null
          loan_amount?: number
          loan_payment_account?: string | null
          loan_start_date?: string | null
          loan_term_months?: number
          lump_sum_payments?: Json
          monthly_insurance?: number
          payment_start_date?: string | null
          phase?: string
          planned_purchase_date?: string | null
          saved_percent?: number
          saved_source?: string
          sort_order?: number
          surplus_share?: number | null
          target_price?: number
          tax_fees?: number
          updated_at?: string
          user_id: string
          vehicle_name: string
        }
        Update: {
          actual_monthly_payment?: number
          auto_extra?: boolean
          auto_extra_auto_cleared?: boolean
          created_at?: string
          current_saved?: number
          down_payment_goal?: number
          expected_apr?: number
          gift_contribution?: number
          id?: string
          insurance_start_date?: string | null
          interest_start_date?: string | null
          linked_account?: string | null
          linked_loan_account_id?: string | null
          linked_rule_id?: string | null
          loan_amount?: number
          loan_payment_account?: string | null
          loan_start_date?: string | null
          loan_term_months?: number
          lump_sum_payments?: Json
          monthly_insurance?: number
          payment_start_date?: string | null
          phase?: string
          planned_purchase_date?: string | null
          saved_percent?: number
          saved_source?: string
          sort_order?: number
          surplus_share?: number | null
          target_price?: number
          tax_fees?: number
          updated_at?: string
          user_id?: string
          vehicle_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_funds_linked_account_fkey"
            columns: ["linked_account"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_funds_linked_loan_account_id_fkey"
            columns: ["linked_loan_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_funds_linked_rule_id_fkey"
            columns: ["linked_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_funds_loan_payment_account_fkey"
            columns: ["loan_payment_account"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      car_maintenance_logs: {
        Row: {
          build_id: string
          cost: number | null
          created_at: string
          id: string
          interval_miles: number | null
          interval_months: number | null
          next_due_date: string | null
          next_due_odometer: number | null
          notes: string | null
          odometer: number | null
          service: string
          service_date: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          build_id: string
          cost?: number | null
          created_at?: string
          id?: string
          interval_miles?: number | null
          interval_months?: number | null
          next_due_date?: string | null
          next_due_odometer?: number | null
          notes?: string | null
          odometer?: number | null
          service: string
          service_date: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          build_id?: string
          cost?: number | null
          created_at?: string
          id?: string
          interval_miles?: number | null
          interval_months?: number | null
          next_due_date?: string | null
          next_due_odometer?: number | null
          notes?: string | null
          odometer?: number | null
          service?: string
          service_date?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "car_maintenance_logs_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "car_builds"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          apr: number
          balance: number
          created_at: string
          credit_limit: number | null
          id: string
          min_payment: number
          name: string
          target_payment: number
          updated_at: string
          user_id: string
        }
        Insert: {
          apr?: number
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          min_payment?: number
          name: string
          target_payment?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          apr?: number
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          min_payment?: number
          name?: string
          target_payment?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          environment: string
          id: string
          last_seen_at: string
          platform: string
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          last_seen_at?: string
          platform: string
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          last_seen_at?: string
          platform?: string
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      email_nudges: {
        Row: {
          sent_at: string
          stage: string
          user_id: string
        }
        Insert: {
          sent_at?: string
          stage: string
          user_id: string
        }
        Update: {
          sent_at?: string
          stage?: string
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          account_type: string | null
          amount: number
          category: string | null
          created_at: string
          currency: string
          date: string
          description: string | null
          drive_file_id: string | null
          drive_link: string | null
          expense_type: string
          id: string
          needs_review: boolean
          notes: string | null
          paid_with: string | null
          payment_method: string | null
          project_client: string | null
          raw: Json | null
          receipt_link: string | null
          receipt_status: string | null
          renews_on: string | null
          reporting_year: number | null
          source: string
          sub_end: string | null
          sub_start: string | null
          subcategory: string | null
          tax_deductible: string
          transaction_id: string
          updated_at: string
          vendor: string
        }
        Insert: {
          account_type?: string | null
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          date: string
          description?: string | null
          drive_file_id?: string | null
          drive_link?: string | null
          expense_type?: string
          id?: string
          needs_review?: boolean
          notes?: string | null
          paid_with?: string | null
          payment_method?: string | null
          project_client?: string | null
          raw?: Json | null
          receipt_link?: string | null
          receipt_status?: string | null
          renews_on?: string | null
          reporting_year?: number | null
          source?: string
          sub_end?: string | null
          sub_start?: string | null
          subcategory?: string | null
          tax_deductible?: string
          transaction_id: string
          updated_at?: string
          vendor: string
        }
        Update: {
          account_type?: string | null
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          date?: string
          description?: string | null
          drive_file_id?: string | null
          drive_link?: string | null
          expense_type?: string
          id?: string
          needs_review?: boolean
          notes?: string | null
          paid_with?: string | null
          payment_method?: string | null
          project_client?: string | null
          raw?: Json | null
          receipt_link?: string | null
          receipt_status?: string | null
          renews_on?: string | null
          reporting_year?: number | null
          source?: string
          sub_end?: string | null
          sub_start?: string | null
          subcategory?: string | null
          tax_deductible?: string
          transaction_id?: string
          updated_at?: string
          vendor?: string
        }
        Relationships: []
      }
      financial_connections: {
        Row: {
          access_token: string | null
          connection_status: string
          created_at: string | null
          id: string
          id_token_encrypted: string | null
          institution_id: string | null
          institution_name: string | null
          last_synced_at: string | null
          provider: string
          provider_item_id: string
          refresh_token_encrypted: string | null
          sync_cursor: string | null
          sync_locked_until: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connection_status?: string
          created_at?: string | null
          id?: string
          id_token_encrypted?: string | null
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          provider?: string
          provider_item_id: string
          refresh_token_encrypted?: string | null
          sync_cursor?: string | null
          sync_locked_until?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          connection_status?: string
          created_at?: string | null
          id?: string
          id_token_encrypted?: string | null
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          provider?: string
          provider_item_id?: string
          refresh_token_encrypted?: string | null
          sync_cursor?: string | null
          sync_locked_until?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      founder_page_views: {
        Row: {
          day: string
          source: string
          views: number
        }
        Insert: {
          day?: string
          source: string
          views?: number
        }
        Update: {
          day?: string
          source?: string
          views?: number
        }
        Relationships: []
      }
      founder_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string
          unsubscribe_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      friend_links: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invite_code_hash: string
          invitee_email: string
          inviter_id: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invite_code_hash: string
          invitee_email: string
          inviter_id: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invite_code_hash?: string
          invitee_email?: string
          inviter_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: []
      }
      leaderboard_shares: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          metric: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          metric: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          metric?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leaderboard_snapshots: {
        Row: {
          bucket_value: number
          created_at: string
          id: string
          metric: string
          updated_at: string
          user_id: string
          week: string
        }
        Insert: {
          bucket_value: number
          created_at?: string
          id?: string
          metric: string
          updated_at?: string
          user_id: string
          week: string
        }
        Update: {
          bucket_value?: number
          created_at?: string
          id?: string
          metric?: string
          updated_at?: string
          user_id?: string
          week?: string
        }
        Relationships: []
      }
      liabilities: {
        Row: {
          apr: number | null
          balance: number
          created_at: string
          id: string
          name: string
          notes: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apr?: number | null
          balance?: number
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apr?: number | null
          balance?: number
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lump_sum_transfers: {
        Row: {
          amount: number
          created_at: string
          date: string
          destination_type: string
          id: string
          label: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          date: string
          destination_type: string
          id?: string
          label?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          destination_type?: string
          id?: string
          label?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketing_slots: {
        Row: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }
        Insert: {
          attempts?: number
          caption: string
          claimed_at?: string | null
          claimed_by?: string | null
          day: string
          fb_message?: string | null
          fb_post_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          image_urls: string[]
          kind: string
          last_error?: string | null
          object_paths?: string[]
          post_id: string
          published_at?: string | null
          slot: string
          staged_at?: string
        }
        Update: {
          attempts?: number
          caption?: string
          claimed_at?: string | null
          claimed_by?: string | null
          day?: string
          fb_message?: string | null
          fb_post_id?: string | null
          ig_media_id?: string | null
          ig_permalink?: string | null
          image_urls?: string[]
          kind?: string
          last_error?: string | null
          object_paths?: string[]
          post_id?: string
          published_at?: string | null
          slot?: string
          staged_at?: string
        }
        Relationships: []
      }
      net_worth_snapshots: {
        Row: {
          created_at: string | null
          id: string
          net_worth: number
          snapshot_date: string
          total_assets: number
          total_liabilities: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          net_worth?: number
          snapshot_date: string
          total_assets?: number
          total_liabilities?: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          net_worth?: number
          snapshot_date?: string
          total_assets?: number
          total_liabilities?: number
          user_id?: string
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          connector: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          provider: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Insert: {
          connector?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          provider: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Update: {
          connector?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          provider?: string
          redirect_uri?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      og_anniversary_runs: {
        Row: {
          action_required: number
          consent_required: number
          created_at: string
          declined: number
          dry_run: boolean
          failed: number
          granted: number
          id: string
          members_due: number
          notes: string | null
          outstanding: number
          ran_at: string
          simulated_due_before: string | null
        }
        Insert: {
          action_required?: number
          consent_required?: number
          created_at?: string
          declined?: number
          dry_run?: boolean
          failed?: number
          granted?: number
          id?: string
          members_due?: number
          notes?: string | null
          outstanding?: number
          ran_at?: string
          simulated_due_before?: string | null
        }
        Update: {
          action_required?: number
          consent_required?: number
          created_at?: string
          declined?: number
          dry_run?: boolean
          failed?: number
          granted?: number
          id?: string
          members_due?: number
          notes?: string | null
          outstanding?: number
          ran_at?: string
          simulated_due_before?: string | null
        }
        Relationships: []
      }
      og_billing_consent: {
        Row: {
          action_taken: string
          consent_sha256: string | null
          consent_text: string | null
          consent_version: string
          created_at: string
          decided_at: string
          decision: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_taken: string
          consent_sha256?: string | null
          consent_text?: string | null
          consent_version: string
          created_at?: string
          decided_at?: string
          decision: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_taken?: string
          consent_sha256?: string | null
          consent_text?: string | null
          consent_version?: string
          created_at?: string
          decided_at?: string
          decision?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      og_consent_tokens: {
        Row: {
          consent_version: string
          created_at: string
          expires_at: string
          id: string
          token_sha256: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          consent_version: string
          created_at?: string
          expires_at: string
          id?: string
          token_sha256: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          consent_version?: string
          created_at?: string
          expires_at?: string
          id?: string
          token_sha256?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      og_members: {
        Row: {
          claimed_at: string
          claimed_provider: string
          created_at: string
          lapse_reason: string | null
          lapsed_at: string | null
          last_premium_at: string
          og_number: number
          reward_action_required_at: string | null
          reward_declined_at: string | null
          reward_declined_reason: string | null
          reward_due_at: string
          reward_granted_at: string | null
          reward_granted_via: string | null
          user_id: string
        }
        Insert: {
          claimed_at?: string
          claimed_provider: string
          created_at?: string
          lapse_reason?: string | null
          lapsed_at?: string | null
          last_premium_at?: string
          og_number: number
          reward_action_required_at?: string | null
          reward_declined_at?: string | null
          reward_declined_reason?: string | null
          reward_due_at: string
          reward_granted_at?: string | null
          reward_granted_via?: string | null
          user_id: string
        }
        Update: {
          claimed_at?: string
          claimed_provider?: string
          created_at?: string
          lapse_reason?: string | null
          lapsed_at?: string | null
          last_premium_at?: string
          og_number?: number
          reward_action_required_at?: string | null
          reward_declined_at?: string | null
          reward_declined_reason?: string | null
          reward_due_at?: string
          reward_granted_at?: string | null
          reward_granted_via?: string | null
          user_id?: string
        }
        Relationships: []
      }
      partner_links: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invite_code_hash: string
          invitee_email: string
          inviter_id: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invite_code_hash: string
          invitee_email: string
          inviter_id: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invite_code_hash?: string
          invitee_email?: string
          inviter_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: []
      }
      payment_plans: {
        Row: {
          active: boolean
          category: string
          created_at: string
          frequency: string
          id: string
          name: string
          notes: string | null
          payment_amount: number
          payment_source: string | null
          plan_type: string
          provider: string | null
          start_date: string
          total_amount: number
          total_payments: number
          user_id: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          frequency: string
          id?: string
          name: string
          notes?: string | null
          payment_amount: number
          payment_source?: string | null
          plan_type?: string
          provider?: string | null
          start_date: string
          total_amount: number
          total_payments: number
          user_id: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          frequency?: string
          id?: string
          name?: string
          notes?: string | null
          payment_amount?: number
          payment_source?: string | null
          plan_type?: string
          provider?: string | null
          start_date?: string
          total_amount?: number
          total_payments?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_consent_accepted: boolean
          ai_consent_accepted_at: string | null
          ai_consent_version: string | null
          auto_generate_recurring: boolean | null
          budget_start_day: number | null
          cards_sort_order: number
          cards_surplus_share: number | null
          cash_floor: number | null
          cash_floor_is_manual: boolean
          compact_mode: boolean | null
          created_at: string
          currency: string | null
          dashboard_layout: Json | null
          deduction_401k_mode: string
          deduction_401k_pretax: boolean
          deduction_401k_value: number
          deduction_fsa: number
          deduction_fsa_mode: string
          deduction_fsa_pretax: boolean
          deduction_hsa: number
          deduction_hsa_mode: string
          deduction_hsa_pretax: boolean
          deduction_medical: number
          deduction_medical_mode: string
          deduction_medical_pretax: boolean
          default_deposit_account: string | null
          display_name: string | null
          forecast_assumptions: Json | null
          founder_note_seen: boolean | null
          gross_income: number | null
          id: string
          is_premium: boolean | null
          last_401k_update: string | null
          monthly_income_default: number | null
          notification_prefs: Json | null
          onboarding_completed: boolean
          onboarding_furthest_step: string | null
          onboarding_started_at: string | null | null
          onboarding_step: number | null
          paycheck_day: number | null
          paycheck_deductions: Json | null
          paycheck_frequency: string | null
          paycheck_rule_id: string | null
          paycheck_start_date: string | null
          referred_by: string | null
          show_cents: boolean | null
          tax_rate: number | null
          timezone: string | null
          tour_flags: Json
          trusted_devices: Json | null
          ui_preferences: Json | null
          updated_at: string
          user_id: string
          weekly_gross_income: number | null
        }
        Insert: {
          ai_consent_accepted?: boolean
          ai_consent_accepted_at?: string | null
          ai_consent_version?: string | null
          auto_generate_recurring?: boolean | null
          budget_start_day?: number | null
          cards_sort_order?: number
          cards_surplus_share?: number | null
          cash_floor?: number | null
          cash_floor_is_manual?: boolean
          compact_mode?: boolean | null
          created_at?: string
          currency?: string | null
          dashboard_layout?: Json | null
          deduction_401k_mode?: string
          deduction_401k_pretax?: boolean
          deduction_401k_value?: number
          deduction_fsa?: number
          deduction_fsa_mode?: string
          deduction_fsa_pretax?: boolean
          deduction_hsa?: number
          deduction_hsa_mode?: string
          deduction_hsa_pretax?: boolean
          deduction_medical?: number
          deduction_medical_mode?: string
          deduction_medical_pretax?: boolean
          default_deposit_account?: string | null
          display_name?: string | null
          forecast_assumptions?: Json | null
          founder_note_seen?: boolean | null
          gross_income?: number | null
          id?: string
          is_premium?: boolean | null
          last_401k_update?: string | null
          monthly_income_default?: number | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean
          onboarding_furthest_step?: string | null
          onboarding_started_at?: string | null | null
          onboarding_step?: number | null
          paycheck_day?: number | null
          paycheck_deductions?: Json | null
          paycheck_frequency?: string | null
          paycheck_rule_id?: string | null
          paycheck_start_date?: string | null
          referred_by?: string | null
          show_cents?: boolean | null
          tax_rate?: number | null
          timezone?: string | null
          tour_flags?: Json
          trusted_devices?: Json | null
          ui_preferences?: Json | null
          updated_at?: string
          user_id: string
          weekly_gross_income?: number | null
        }
        Update: {
          ai_consent_accepted?: boolean
          ai_consent_accepted_at?: string | null
          ai_consent_version?: string | null
          auto_generate_recurring?: boolean | null
          budget_start_day?: number | null
          cards_sort_order?: number
          cards_surplus_share?: number | null
          cash_floor?: number | null
          cash_floor_is_manual?: boolean
          compact_mode?: boolean | null
          created_at?: string
          currency?: string | null
          dashboard_layout?: Json | null
          deduction_401k_mode?: string
          deduction_401k_pretax?: boolean
          deduction_401k_value?: number
          deduction_fsa?: number
          deduction_fsa_mode?: string
          deduction_fsa_pretax?: boolean
          deduction_hsa?: number
          deduction_hsa_mode?: string
          deduction_hsa_pretax?: boolean
          deduction_medical?: number
          deduction_medical_mode?: string
          deduction_medical_pretax?: boolean
          default_deposit_account?: string | null
          display_name?: string | null
          forecast_assumptions?: Json | null
          founder_note_seen?: boolean | null
          gross_income?: number | null
          id?: string
          is_premium?: boolean | null
          last_401k_update?: string | null
          monthly_income_default?: number | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean
          onboarding_furthest_step?: string | null
          onboarding_started_at?: string | null | null
          onboarding_step?: number | null
          paycheck_day?: number | null
          paycheck_deductions?: Json | null
          paycheck_frequency?: string | null
          paycheck_rule_id?: string | null
          paycheck_start_date?: string | null
          referred_by?: string | null
          show_cents?: boolean | null
          tax_rate?: number | null
          timezone?: string | null
          tour_flags?: Json
          trusted_devices?: Json | null
          ui_preferences?: Json | null
          updated_at?: string
          user_id?: string
          weekly_gross_income?: number | null
        }
        Relationships: []
      }
      push_send_runs: {
        Row: {
          candidates: number
          created_at: string
          dry_run: boolean
          duplicate: number
          failed: number
          id: string
          notes: string | null
          ran_at: string
          scoped_user_id: string | null
          sent: number
          unreachable: number
        }
        Insert: {
          candidates?: number
          created_at?: string
          dry_run?: boolean
          duplicate?: number
          failed?: number
          id?: string
          notes?: string | null
          ran_at?: string
          scoped_user_id?: string | null
          sent?: number
          unreachable?: number
        }
        Update: {
          candidates?: number
          created_at?: string
          dry_run?: boolean
          duplicate?: number
          failed?: number
          id?: string
          notes?: string | null
          ran_at?: string
          scoped_user_id?: string | null
          sent?: number
          unreachable?: number
        }
        Relationships: []
      }
      push_sends: {
        Row: {
          created_at: string
          devices_sent: number
          id: string
          kind: string
          notification_key: string
          sent_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          devices_sent?: number
          id?: string
          kind: string
          notification_key: string
          sent_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          devices_sent?: number
          id?: string
          kind?: string
          notification_key?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          updated_at: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      recurring_rules: {
        Row: {
          active: boolean
          amount: number
          category: string
          cost_type: string | null
          created_at: string
          deposit_account: string | null
          due_day: number
          due_month: number | null
          end_date: string | null
          frequency: string
          id: string
          interval_count: number | null
          interval_unit: string | null
          name: string
          notes: string | null
          payment_source: string | null
          rule_type: string
          start_date: string | null
          tax_rate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount?: number
          category?: string
          cost_type?: string | null
          created_at?: string
          deposit_account?: string | null
          due_day?: number
          due_month?: number | null
          end_date?: string | null
          frequency?: string
          id?: string
          interval_count?: number | null
          interval_unit?: string | null
          name: string
          notes?: string | null
          payment_source?: string | null
          rule_type?: string
          start_date?: string | null
          tax_rate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          cost_type?: string | null
          created_at?: string
          deposit_account?: string | null
          due_day?: number
          due_month?: number | null
          end_date?: string | null
          frequency?: string
          id?: string
          interval_count?: number | null
          interval_unit?: string | null
          name?: string
          notes?: string | null
          payment_source?: string | null
          rule_type?: string
          start_date?: string | null
          tax_rate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reddit_scout_pending_runs: {
        Row: {
          attempts: number
          created_at: string
          last_error: string | null
          run_date: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          last_error?: string | null
          run_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          last_error?: string | null
          run_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      reddit_scout_seen_posts: {
        Row: {
          id: string
          permalink: string | null
          post_id: string
          score: number | null
          seen_at: string | null
          subreddit: string
          title: string | null
        }
        Insert: {
          id?: string
          permalink?: string | null
          post_id: string
          score?: number | null
          seen_at?: string | null
          subreddit: string
          title?: string | null
        }
        Update: {
          id?: string
          permalink?: string | null
          post_id?: string
          score?: number | null
          seen_at?: string | null
          subreddit?: string
          title?: string | null
        }
        Relationships: []
      }
      savings_goals: {
        Row: {
          auto_end_contributions: boolean
          auto_end_stamped_rules: Json
          auto_extra: boolean
          auto_extra_auto_cleared: boolean
          contribution_start_date: string | null
          created_at: string
          current_amount: number
          emergency_months_stage1: number | null
          emergency_months_stage2: number | null
          goal_type: string
          id: string
          linked_account: string | null
          linked_rule_id: string | null
          linked_rule_ids: string[]
          lump_sum_payments: Json
          monthly_contribution: number
          name: string
          sort_order: number
          stages: Json
          surplus_share: number | null
          target_amount: number
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_end_contributions?: boolean
          auto_end_stamped_rules?: Json
          auto_extra?: boolean
          auto_extra_auto_cleared?: boolean
          contribution_start_date?: string | null
          created_at?: string
          current_amount?: number
          emergency_months_stage1?: number | null
          emergency_months_stage2?: number | null
          goal_type?: string
          id?: string
          linked_account?: string | null
          linked_rule_id?: string | null
          linked_rule_ids?: string[]
          lump_sum_payments?: Json
          monthly_contribution?: number
          name: string
          sort_order?: number
          stages?: Json
          surplus_share?: number | null
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_end_contributions?: boolean
          auto_end_stamped_rules?: Json
          auto_extra?: boolean
          auto_extra_auto_cleared?: boolean
          contribution_start_date?: string | null
          created_at?: string
          current_amount?: number
          emergency_months_stage1?: number | null
          emergency_months_stage2?: number | null
          goal_type?: string
          id?: string
          linked_account?: string | null
          linked_rule_id?: string | null
          linked_rule_ids?: string[]
          lump_sum_payments?: Json
          monthly_contribution?: number
          name?: string
          sort_order?: number
          stages?: Json
          surplus_share?: number | null
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_tiers: {
        Row: {
          created_at: string
          features: Json | null
          id: string
          name: string
          price_annual: number
          price_monthly: number
          stripe_price_id_annual: string | null
          stripe_price_id_monthly: string | null
        }
        Insert: {
          created_at?: string
          features?: Json | null
          id?: string
          name: string
          price_annual?: number
          price_monthly?: number
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
        }
        Update: {
          created_at?: string
          features?: Json | null
          id?: string
          name?: string
          price_annual?: number
          price_monthly?: number
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
        }
        Relationships: []
      }
      streak_rewards: {
        Row: {
          expires_at: string
          granted_at: string
          id: string
          revoked_at: string | null
          streak_days: number
          user_id: string
        }
        Insert: {
          expires_at: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          streak_days: number
          user_id: string
        }
        Update: {
          expires_at?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          streak_days?: number
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          active: boolean
          billing: string
          cost: number
          created_at: string
          id: string
          name: string
          renewal_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          billing?: string
          cost?: number
          created_at?: string
          id?: string
          name: string
          renewal_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          billing?: string
          cost?: number
          created_at?: string
          id?: string
          name?: string
          renewal_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      synced_transaction_reviews: {
        Row: {
          car_charge_kind: string | null
          car_fund_id: string | null
          category_override: string | null
          created_at: string
          id: string
          occurrence_date: string | null
          occurrence_month: string | null
          payment_plan_id: string | null
          rule_id: string | null
          status: string
          synced_transaction_id: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          car_charge_kind?: string | null
          car_fund_id?: string | null
          category_override?: string | null
          created_at?: string
          id?: string
          occurrence_date?: string | null
          occurrence_month?: string | null
          payment_plan_id?: string | null
          rule_id?: string | null
          status: string
          synced_transaction_id: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          car_charge_kind?: string | null
          car_fund_id?: string | null
          category_override?: string | null
          created_at?: string
          id?: string
          occurrence_date?: string | null
          occurrence_month?: string | null
          payment_plan_id?: string | null
          rule_id?: string | null
          status?: string
          synced_transaction_id?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "synced_transaction_reviews_car_fund_id_fkey"
            columns: ["car_fund_id"]
            isOneToOne: false
            referencedRelation: "car_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transaction_reviews_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transaction_reviews_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transaction_reviews_synced_transaction_id_fkey"
            columns: ["synced_transaction_id"]
            isOneToOne: false
            referencedRelation: "synced_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transaction_reviews_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      synced_transactions: {
        Row: {
          account_id: string | null
          amount: number
          category: string | null
          connection_id: string
          created_at: string
          date: string
          id: string
          merchant_name: string | null
          name: string | null
          pending: boolean
          pending_transaction_id: string | null
          provider_transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category?: string | null
          connection_id: string
          created_at?: string
          date: string
          id?: string
          merchant_name?: string | null
          name?: string | null
          pending?: boolean
          pending_transaction_id?: string | null
          provider_transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string | null
          connection_id?: string
          created_at?: string
          date?: string
          id?: string
          merchant_name?: string | null
          name?: string | null
          pending?: boolean
          pending_transaction_id?: string | null
          provider_transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "synced_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "financial_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synced_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account: string | null
          amount: number
          car_build_item_id: string | null
          car_maintenance_log_id: string | null
          category: string
          created_at: string
          date: string
          id: string
          note: string | null
          origin: string
          payment_source: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account?: string | null
          amount: number
          car_build_item_id?: string | null
          car_maintenance_log_id?: string | null
          category?: string
          created_at?: string
          date?: string
          id?: string
          note?: string | null
          origin?: string
          payment_source?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account?: string | null
          amount?: number
          car_build_item_id?: string | null
          car_maintenance_log_id?: string | null
          category?: string
          created_at?: string
          date?: string
          id?: string
          note?: string | null
          origin?: string
          payment_source?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_car_build_item_id_fkey"
            columns: ["car_build_item_id"]
            isOneToOne: false
            referencedRelation: "car_build_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_car_maintenance_log_id_fkey"
            columns: ["car_maintenance_log_id"]
            isOneToOne: false
            referencedRelation: "car_maintenance_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          anonymized_at: string | null
          apple_original_transaction_id: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          is_comp: boolean
          plan: string | null
          purchase_provider: string | null
          revenuecat_app_user_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          anonymized_at?: string | null
          apple_original_transaction_id?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          is_comp?: boolean
          plan?: string | null
          purchase_provider?: string | null
          revenuecat_app_user_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          anonymized_at?: string | null
          apple_original_transaction_id?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          is_comp?: boolean
          plan?: string | null
          purchase_provider?: string | null
          revenuecat_app_user_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      plaid_items: {
        Row: {
          created_at: string | null
          id: string | null
          institution_id: string | null
          institution_name: string | null
          last_synced_at: string | null
          plaid_item_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_item_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_item_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      active_friend_ids: { Args: never; Returns: string[] }
      active_partner_id: { Args: never; Returns: string }
      bump_founder_view: { Args: { p_source: string }; Returns: undefined }
      claim_streak_reward: { Args: never; Returns: Json }
      expire_streak_rewards: { Args: never; Returns: number }
      streak_days_for: { Args: { p_user: string }; Returns: number }
      claim_marketing_slot: {
        Args: {
          p_by: string
          p_day: string
          p_kind: string
          p_lease?: string
          p_slot: string
        }
        Returns: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_slots"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_marketing_slot: {
        Args: {
          p_day: string
          p_fb_post_id?: string
          p_ig_media_id?: string
          p_ig_permalink?: string
          p_kind: string
          p_slot: string
        }
        Returns: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_slots"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crowd_merchant_categories: {
        Args: { p_min_voters?: number }
        Returns: {
          category: string
          merchant_key: string
          voters: number
        }[]
      }
      fail_marketing_slot: {
        Args: { p_day: string; p_error: string; p_kind: string; p_slot: string }
        Returns: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_slots"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_users_to_nudge: {
        Args: never
        Returns: {
          email: string
          stage: string
          user_id: string
        }[]
      }
      is_metric_shared: {
        Args: { p_metric: string; p_user_id: string }
        Returns: boolean
      }
      og_anniversary_last_run: {
        Args: never
        Returns: {
          dry_run: boolean
          failed: number
          granted: number
          members_due: number
          ran_at: string
        }[]
      }
      og_billing_consent_current: {
        Args: { p_user_id: string }
        Returns: {
          consent_version: string
          decided_at: string
          decision: string
        }[]
      }
      og_reward_eligible: {
        Args: { p_at?: string; p_user_id: string }
        Returns: boolean
      }
      rate_limit_check: {
        Args: { p_key: string; p_max: number; p_window_ms: number }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      record_merchant_category_vote: {
        Args: { p_category: string; p_merchant_key: string }
        Returns: undefined
      }
      record_push_registration: {
        Args: { p_outcome: string; p_platform: string; p_prompted?: boolean }
        Returns: undefined
      }
      revenue_summary_lines: {
        Args: never
        Returns: {
          comped: number
          count: number
          ending: number
          plan: string
          provider: string
          status: string
        }[]
      }
      savings_goal_stages_valid: { Args: { stages: Json }; Returns: boolean }
      stage_marketing_slot: {
        Args: {
          p_caption: string
          p_day: string
          p_fb_message: string
          p_image_urls: string[]
          p_kind: string
          p_object_paths?: string[]
          p_post_id: string
          p_slot: string
        }
        Returns: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_slots"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      unstage_marketing_slot: {
        Args: { p_day: string; p_kind: string; p_slot: string }
        Returns: {
          attempts: number
          caption: string
          claimed_at: string | null
          claimed_by: string | null
          day: string
          fb_message: string | null
          fb_post_id: string | null
          ig_media_id: string | null
          ig_permalink: string | null
          image_urls: string[]
          kind: string
          last_error: string | null
          object_paths: string[]
          post_id: string
          published_at: string | null
          slot: string
          staged_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_slots"
          isOneToOne: false
          isSetofReturn: true
        }
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
    Enums: {},
  },
} as const
