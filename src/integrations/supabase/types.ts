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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      buyer_contacts: {
        Row: {
          appetite_notes: string
          buyer_name: string
          company: string
          company_type: string
          created_at: string
          email: string
          genres_interest: string[]
          id: string
          last_contact_at: string | null
          phone: string
          relationship_status: string
          territories: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          appetite_notes?: string
          buyer_name?: string
          company?: string
          company_type?: string
          created_at?: string
          email?: string
          genres_interest?: string[]
          id?: string
          last_contact_at?: string | null
          phone?: string
          relationship_status?: string
          territories?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          appetite_notes?: string
          buyer_name?: string
          company?: string
          company_type?: string
          created_at?: string
          email?: string
          genres_interest?: string[]
          id?: string
          last_contact_at?: string | null
          phone?: string
          relationship_status?: string
          territories?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      buyer_meetings: {
        Row: {
          buyer_contact_id: string
          created_at: string
          follow_up: string
          id: string
          location: string
          meeting_date: string
          meeting_type: string
          notes: string
          outcome: string
          project_id: string | null
          user_id: string
        }
        Insert: {
          buyer_contact_id: string
          created_at?: string
          follow_up?: string
          id?: string
          location?: string
          meeting_date?: string
          meeting_type?: string
          notes?: string
          outcome?: string
          project_id?: string | null
          user_id: string
        }
        Update: {
          buyer_contact_id?: string
          created_at?: string
          follow_up?: string
          id?: string
          location?: string
          meeting_date?: string
          meeting_type?: string
          notes?: string
          outcome?: string
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_meetings_buyer_contact_id_fkey"
            columns: ["buyer_contact_id"]
            isOneToOne: false
            referencedRelation: "buyer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_meetings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cast_trends: {
        Row: {
          actor_name: string
          age_band: string
          archived_at: string | null
          created_at: string
          cycle_phase: string
          explanation: string
          first_detected_at: string
          genre_relevance: string[]
          id: string
          last_updated_at: string
          market_alignment: string
          region: string
          sales_leverage: string
          status: string
          timing_window: string
          trend_type: string
        }
        Insert: {
          actor_name: string
          age_band?: string
          archived_at?: string | null
          created_at?: string
          cycle_phase?: string
          explanation: string
          first_detected_at?: string
          genre_relevance?: string[]
          id?: string
          last_updated_at?: string
          market_alignment?: string
          region?: string
          sales_leverage?: string
          status?: string
          timing_window?: string
          trend_type?: string
        }
        Update: {
          actor_name?: string
          age_band?: string
          archived_at?: string | null
          created_at?: string
          cycle_phase?: string
          explanation?: string
          first_detected_at?: string
          genre_relevance?: string[]
          id?: string
          last_updated_at?: string
          market_alignment?: string
          region?: string
          sales_leverage?: string
          status?: string
          timing_window?: string
          trend_type?: string
        }
        Relationships: []
      }
      copro_frameworks: {
        Row: {
          confidence: string
          created_at: string
          cultural_requirements: string
          eligible_countries: string[]
          id: string
          last_verified_at: string
          max_share_pct: number | null
          min_share_pct: number | null
          name: string
          notes: string
          source_url: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          cultural_requirements?: string
          eligible_countries?: string[]
          id?: string
          last_verified_at?: string
          max_share_pct?: number | null
          min_share_pct?: number | null
          name: string
          notes?: string
          source_url?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          cultural_requirements?: string
          eligible_countries?: string[]
          id?: string
          last_verified_at?: string
          max_share_pct?: number | null
          min_share_pct?: number | null
          name?: string
          notes?: string
          source_url?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      incentive_programs: {
        Row: {
          caps_limits: string
          confidence: string
          country_code: string
          created_at: string
          eligibility_summary: string
          formats_supported: string[]
          headline_rate: string
          id: string
          jurisdiction: string
          last_verified_at: string
          name: string
          notes: string
          payment_timing: string
          qualifying_spend_rules: string
          source_url: string
          stackability: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          caps_limits?: string
          confidence?: string
          country_code?: string
          created_at?: string
          eligibility_summary?: string
          formats_supported?: string[]
          headline_rate?: string
          id?: string
          jurisdiction: string
          last_verified_at?: string
          name: string
          notes?: string
          payment_timing?: string
          qualifying_spend_rules?: string
          source_url?: string
          stackability?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          caps_limits?: string
          confidence?: string
          country_code?: string
          created_at?: string
          eligibility_summary?: string
          formats_supported?: string[]
          headline_rate?: string
          id?: string
          jurisdiction?: string
          last_verified_at?: string
          name?: string
          notes?: string
          payment_timing?: string
          qualifying_spend_rules?: string
          source_url?: string
          stackability?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_buyers: {
        Row: {
          appetite_notes: string
          budget_sweet_spot: string[]
          company_type: string
          confidence: string
          created_at: string
          deal_types: string[]
          formats: string[]
          genres_acquired: string[]
          id: string
          last_verified_at: string
          market_presence: string
          name: string
          recent_acquisitions: string
          source_url: string
          status: string
          territories: string[]
          tone_preferences: string[]
          updated_at: string
        }
        Insert: {
          appetite_notes?: string
          budget_sweet_spot?: string[]
          company_type?: string
          confidence?: string
          created_at?: string
          deal_types?: string[]
          formats?: string[]
          genres_acquired?: string[]
          id?: string
          last_verified_at?: string
          market_presence?: string
          name: string
          recent_acquisitions?: string
          source_url?: string
          status?: string
          territories?: string[]
          tone_preferences?: string[]
          updated_at?: string
        }
        Update: {
          appetite_notes?: string
          budget_sweet_spot?: string[]
          company_type?: string
          confidence?: string
          created_at?: string
          deal_types?: string[]
          formats?: string[]
          genres_acquired?: string[]
          id?: string
          last_verified_at?: string
          market_presence?: string
          name?: string
          recent_acquisitions?: string
          source_url?: string
          status?: string
          territories?: string[]
          tone_preferences?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string
          project_id: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          link?: string
          project_id?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string
          project_id?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_cast: {
        Row: {
          actor_name: string
          created_at: string
          id: string
          notes: string
          project_id: string
          role_name: string
          status: string
          territory_tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_name?: string
          created_at?: string
          id?: string
          notes?: string
          project_id: string
          role_name?: string
          status?: string
          territory_tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_name?: string
          created_at?: string
          id?: string
          notes?: string
          project_id?: string
          role_name?: string
          status?: string
          territory_tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cast_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collaborators: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          invited_by: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          parent_id: string | null
          project_id: string
          section: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          parent_id?: string | null
          project_id: string
          section?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          project_id?: string
          section?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_copro_scenarios: {
        Row: {
          contributions: string
          copro_framework_id: string | null
          created_at: string
          eligibility_status: string
          id: string
          notes: string
          project_id: string
          proposed_splits: Json
          risks: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contributions?: string
          copro_framework_id?: string | null
          created_at?: string
          eligibility_status?: string
          id?: string
          notes?: string
          project_id: string
          proposed_splits?: Json
          risks?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contributions?: string
          copro_framework_id?: string | null
          created_at?: string
          eligibility_status?: string
          id?: string
          notes?: string
          project_id?: string
          proposed_splits?: Json
          risks?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_copro_scenarios_copro_framework_id_fkey"
            columns: ["copro_framework_id"]
            isOneToOne: false
            referencedRelation: "copro_frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_copro_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_deals: {
        Row: {
          buyer_name: string
          closed_at: string | null
          created_at: string
          currency: string
          deal_type: string
          id: string
          minimum_guarantee: string
          notes: string
          offered_at: string | null
          project_id: string
          status: string
          territory: string
          updated_at: string
          user_id: string
        }
        Insert: {
          buyer_name?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          deal_type?: string
          id?: string
          minimum_guarantee?: string
          notes?: string
          offered_at?: string | null
          project_id: string
          status?: string
          territory?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          buyer_name?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          deal_type?: string
          id?: string
          minimum_guarantee?: string
          notes?: string
          offered_at?: string | null
          project_id?: string
          status?: string
          territory?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_deals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          created_at: string
          error_message: string | null
          extracted_text: string | null
          extraction_status: string
          file_name: string
          file_path: string
          id: string
          pages_analyzed: number | null
          project_id: string
          total_pages: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          extracted_text?: string | null
          extraction_status?: string
          file_name: string
          file_path: string
          id?: string
          pages_analyzed?: number | null
          project_id: string
          total_pages?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          extracted_text?: string | null
          extraction_status?: string
          file_name?: string
          file_path?: string
          id?: string
          pages_analyzed?: number | null
          project_id?: string
          total_pages?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_finance_scenarios: {
        Row: {
          confidence: string
          created_at: string
          equity_amount: string
          gap_amount: string
          id: string
          incentive_amount: string
          notes: string
          other_sources: string
          presales_amount: string
          project_id: string
          scenario_name: string
          total_budget: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          equity_amount?: string
          gap_amount?: string
          id?: string
          incentive_amount?: string
          notes?: string
          other_sources?: string
          presales_amount?: string
          project_id: string
          scenario_name?: string
          total_budget?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          equity_amount?: string
          gap_amount?: string
          id?: string
          incentive_amount?: string
          notes?: string
          other_sources?: string
          presales_amount?: string
          project_id?: string
          scenario_name?: string
          total_budget?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_finance_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_hods: {
        Row: {
          created_at: string
          department: string
          id: string
          known_for: string
          notes: string
          person_name: string
          project_id: string
          reputation_tier: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string
          id?: string
          known_for?: string
          notes?: string
          person_name?: string
          project_id: string
          reputation_tier?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string
          id?: string
          known_for?: string
          notes?: string
          person_name?: string
          project_id?: string
          reputation_tier?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_hods_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_incentive_scenarios: {
        Row: {
          blockers: string
          confidence: string
          created_at: string
          estimated_benefit: string
          estimated_qualifying_spend: string
          id: string
          incentive_program_id: string | null
          jurisdiction: string
          next_steps: string
          notes: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blockers?: string
          confidence?: string
          created_at?: string
          estimated_benefit?: string
          estimated_qualifying_spend?: string
          id?: string
          incentive_program_id?: string | null
          jurisdiction?: string
          next_steps?: string
          notes?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          blockers?: string
          confidence?: string
          created_at?: string
          estimated_benefit?: string
          estimated_qualifying_spend?: string
          id?: string
          incentive_program_id?: string | null
          jurisdiction?: string
          next_steps?: string
          notes?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_incentive_scenarios_incentive_program_id_fkey"
            columns: ["incentive_program_id"]
            isOneToOne: false
            referencedRelation: "incentive_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_incentive_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invite_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          token: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          max_uses?: number | null
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          token?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_uses?: number | null
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_invite_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_partners: {
        Row: {
          created_at: string
          id: string
          notes: string
          partner_name: string
          partner_type: string
          project_id: string
          status: string
          territory: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string
          partner_name?: string
          partner_type?: string
          project_id: string
          status?: string
          territory?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          partner_name?: string
          partner_type?: string
          project_id?: string
          status?: string
          territory?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_partners_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scenes: {
        Row: {
          cast_members: string[]
          created_at: string
          description: string
          heading: string
          id: string
          int_ext: string
          location: string
          notes: string
          page_count: number | null
          project_id: string
          scene_number: string
          time_of_day: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cast_members?: string[]
          created_at?: string
          description?: string
          heading: string
          id?: string
          int_ext?: string
          location?: string
          notes?: string
          page_count?: number | null
          project_id: string
          scene_number: string
          time_of_day?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cast_members?: string[]
          created_at?: string
          description?: string
          heading?: string
          id?: string
          int_ext?: string
          location?: string
          notes?: string
          page_count?: number | null
          project_id?: string
          scene_number?: string
          time_of_day?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scripts: {
        Row: {
          created_at: string
          file_path: string | null
          id: string
          notes: string
          project_id: string
          status: string
          updated_at: string
          user_id: string
          version_label: string
        }
        Insert: {
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string
          project_id: string
          status?: string
          updated_at?: string
          user_id: string
          version_label?: string
        }
        Update: {
          created_at?: string
          file_path?: string | null
          id?: string
          notes?: string
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_talent_triage: {
        Row: {
          commercial_case: string
          created_at: string
          creative_fit: string
          id: string
          image_url: string
          person_name: string
          person_type: string
          priority_rank: number | null
          project_id: string
          role_suggestion: string
          status: string
          suggestion_context: string
          suggestion_source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          commercial_case?: string
          created_at?: string
          creative_fit?: string
          id?: string
          image_url?: string
          person_name: string
          person_type?: string
          priority_rank?: number | null
          project_id: string
          role_suggestion?: string
          status?: string
          suggestion_context?: string
          suggestion_source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          commercial_case?: string
          created_at?: string
          creative_fit?: string
          id?: string
          image_url?: string
          person_name?: string
          person_type?: string
          priority_rank?: number | null
          project_id?: string
          role_suggestion?: string
          status?: string
          suggestion_context?: string
          suggestion_source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_talent_triage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          created_at: string
          description: string
          id: string
          impact_summary: string | null
          project_id: string
          title: string
          update_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          impact_summary?: string | null
          project_id: string
          title?: string
          update_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          impact_summary?: string | null
          project_id?: string
          title?: string
          update_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          analysis_passes: Json | null
          assigned_lane: string | null
          budget_range: string
          comparable_titles: string
          confidence: number | null
          created_at: string
          document_urls: string[]
          format: string
          genres: string[]
          id: string
          incentive_insights: Json | null
          pipeline_stage: string
          reasoning: string | null
          recommendations: Json | null
          target_audience: string
          title: string
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_passes?: Json | null
          assigned_lane?: string | null
          budget_range?: string
          comparable_titles?: string
          confidence?: number | null
          created_at?: string
          document_urls?: string[]
          format?: string
          genres?: string[]
          id?: string
          incentive_insights?: Json | null
          pipeline_stage?: string
          reasoning?: string | null
          recommendations?: Json | null
          target_audience?: string
          title: string
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_passes?: Json | null
          assigned_lane?: string | null
          budget_range?: string
          comparable_titles?: string
          confidence?: number | null
          created_at?: string
          document_urls?: string[]
          format?: string
          genres?: string[]
          id?: string
          incentive_insights?: Json | null
          pipeline_stage?: string
          reasoning?: string | null
          recommendations?: Json | null
          target_audience?: string
          title?: string
          tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scene_schedule: {
        Row: {
          call_time: string | null
          created_at: string
          dependencies: string[]
          id: string
          notes: string
          project_id: string
          scene_id: string
          shoot_day_id: string
          sort_order: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          call_time?: string | null
          created_at?: string
          dependencies?: string[]
          id?: string
          notes?: string
          project_id: string
          scene_id: string
          shoot_day_id: string
          sort_order?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          call_time?: string | null
          created_at?: string
          dependencies?: string[]
          id?: string
          notes?: string
          project_id?: string
          scene_id?: string
          shoot_day_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_schedule_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_schedule_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "project_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_schedule_shoot_day_id_fkey"
            columns: ["shoot_day_id"]
            isOneToOne: false
            referencedRelation: "shoot_days"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_days: {
        Row: {
          created_at: string
          day_number: number
          id: string
          notes: string
          project_id: string
          shoot_date: string
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_number?: number
          id?: string
          notes?: string
          project_id: string
          shoot_date: string
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_number?: number
          id?: string
          notes?: string
          project_id?: string
          shoot_date?: string
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shoot_days_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      trend_signals: {
        Row: {
          archived_at: string | null
          category: string
          created_at: string
          cycle_phase: string
          explanation: string
          first_detected_at: string
          format_tags: string[]
          genre_tags: string[]
          id: string
          lane_relevance: string[]
          last_updated_at: string
          name: string
          region: string
          sources_count: number
          status: string
          tone_tags: string[]
        }
        Insert: {
          archived_at?: string | null
          category: string
          created_at?: string
          cycle_phase: string
          explanation: string
          first_detected_at?: string
          format_tags?: string[]
          genre_tags?: string[]
          id?: string
          lane_relevance?: string[]
          last_updated_at?: string
          name: string
          region?: string
          sources_count?: number
          status?: string
          tone_tags?: string[]
        }
        Update: {
          archived_at?: string | null
          category?: string
          created_at?: string
          cycle_phase?: string
          explanation?: string
          first_detected_at?: string
          format_tags?: string[]
          genre_tags?: string[]
          id?: string
          lane_relevance?: string[]
          last_updated_at?: string
          name?: string
          region?: string
          sources_count?: number
          status?: string
          tone_tags?: string[]
        }
        Relationships: []
      }
      trend_weekly_briefs: {
        Row: {
          created_at: string
          id: string
          summary: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          summary: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          summary?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite_link: { Args: { _token: string }; Returns: Json }
      check_document_access: {
        Args: { _file_path: string; _user_id: string }
        Returns: boolean
      }
      get_project_role: {
        Args: { _project_id: string; _user_id: string }
        Returns: string
      }
      has_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      project_role: "producer" | "sales_agent" | "lawyer" | "creative"
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
    Enums: {
      project_role: ["producer", "sales_agent", "lawyer", "creative"],
    },
  },
} as const
