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
      approved_sources: {
        Row: {
          added_by: string
          created_at: string
          format: string
          id: string
          license_reference: string
          rights_status: string
          source_url: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          added_by?: string
          created_at?: string
          format?: string
          id?: string
          license_reference?: string
          rights_status?: string
          source_url?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          format?: string
          id?: string
          license_reference?: string
          rights_status?: string
          source_url?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      budget_assumptions: {
        Row: {
          budget_band: string | null
          cast_level: string | null
          created_at: string
          currency: string | null
          estimated_total: number | null
          id: string
          location_count: number | null
          notes: string | null
          project_id: string
          schedule_weeks: number | null
          shoot_days: number | null
          union_level: string | null
          updated_at: string
          user_id: string
          version: number | null
          vfx_level: string | null
        }
        Insert: {
          budget_band?: string | null
          cast_level?: string | null
          created_at?: string
          currency?: string | null
          estimated_total?: number | null
          id?: string
          location_count?: number | null
          notes?: string | null
          project_id: string
          schedule_weeks?: number | null
          shoot_days?: number | null
          union_level?: string | null
          updated_at?: string
          user_id: string
          version?: number | null
          vfx_level?: string | null
        }
        Update: {
          budget_band?: string | null
          cast_level?: string | null
          created_at?: string
          currency?: string | null
          estimated_total?: number | null
          id?: string
          location_count?: number | null
          notes?: string | null
          project_id?: string
          schedule_weeks?: number | null
          shoot_days?: number | null
          union_level?: string | null
          updated_at?: string
          user_id?: string
          version?: number | null
          vfx_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_assumptions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
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
          budget_tier: string
          created_at: string
          cycle_phase: string
          explanation: string
          first_detected_at: string
          forecast: string
          genre_relevance: string[]
          id: string
          last_updated_at: string
          market_alignment: string
          production_type: string
          region: string
          sales_leverage: string
          saturation_risk: string
          status: string
          strength: number
          target_buyer: string
          timing_window: string
          trend_type: string
          velocity: string
        }
        Insert: {
          actor_name: string
          age_band?: string
          archived_at?: string | null
          budget_tier?: string
          created_at?: string
          cycle_phase?: string
          explanation: string
          first_detected_at?: string
          forecast?: string
          genre_relevance?: string[]
          id?: string
          last_updated_at?: string
          market_alignment?: string
          production_type?: string
          region?: string
          sales_leverage?: string
          saturation_risk?: string
          status?: string
          strength?: number
          target_buyer?: string
          timing_window?: string
          trend_type?: string
          velocity?: string
        }
        Update: {
          actor_name?: string
          age_band?: string
          archived_at?: string | null
          budget_tier?: string
          created_at?: string
          cycle_phase?: string
          explanation?: string
          first_detected_at?: string
          forecast?: string
          genre_relevance?: string[]
          id?: string
          last_updated_at?: string
          market_alignment?: string
          production_type?: string
          region?: string
          sales_leverage?: string
          saturation_risk?: string
          status?: string
          strength?: number
          target_buyer?: string
          timing_window?: string
          trend_type?: string
          velocity?: string
        }
        Relationships: []
      }
      commercial_proof: {
        Row: {
          active: boolean
          audience_target: string
          budget_tier: string
          concept_simplicity: string
          created_at: string
          dataset_type: string
          format: string
          franchise_potential: string
          genre: string
          hook_clarity: string
          id: string
          international_travelability: string
          production_budget_est: string | null
          roi_tier: string
          streamer_appeal: string
          title: string
          trailer_moment_density: string
          updated_at: string
          weight: string
          worldwide_gross_est: string | null
          year: number
        }
        Insert: {
          active?: boolean
          audience_target?: string
          budget_tier?: string
          concept_simplicity?: string
          created_at?: string
          dataset_type?: string
          format?: string
          franchise_potential?: string
          genre: string
          hook_clarity?: string
          id?: string
          international_travelability?: string
          production_budget_est?: string | null
          roi_tier?: string
          streamer_appeal?: string
          title: string
          trailer_moment_density?: string
          updated_at?: string
          weight?: string
          worldwide_gross_est?: string | null
          year: number
        }
        Update: {
          active?: boolean
          audience_target?: string
          budget_tier?: string
          concept_simplicity?: string
          created_at?: string
          dataset_type?: string
          format?: string
          franchise_potential?: string
          genre?: string
          hook_clarity?: string
          id?: string
          international_travelability?: string
          production_budget_est?: string | null
          roi_tier?: string
          streamer_appeal?: string
          title?: string
          trailer_moment_density?: string
          updated_at?: string
          weight?: string
          worldwide_gross_est?: string | null
          year?: number
        }
        Relationships: []
      }
      company_intelligence_profiles: {
        Row: {
          attachment_tier_range: string
          bias_weighting_modifier: number
          budget_sweet_spot_max: number | null
          budget_sweet_spot_min: number | null
          company_id: string | null
          company_name: string
          created_at: string
          created_by: string
          finance_tolerance: string
          genre_bias_list: string[] | null
          id: string
          mode_name: string
          packaging_strength: string
          series_track_record: string
          strategic_priorities: string | null
          streamer_bias_list: string[] | null
          updated_at: string
        }
        Insert: {
          attachment_tier_range?: string
          bias_weighting_modifier?: number
          budget_sweet_spot_max?: number | null
          budget_sweet_spot_min?: number | null
          company_id?: string | null
          company_name: string
          created_at?: string
          created_by: string
          finance_tolerance?: string
          genre_bias_list?: string[] | null
          id?: string
          mode_name?: string
          packaging_strength?: string
          series_track_record?: string
          strategic_priorities?: string | null
          streamer_bias_list?: string[] | null
          updated_at?: string
        }
        Update: {
          attachment_tier_range?: string
          bias_weighting_modifier?: number
          budget_sweet_spot_max?: number | null
          budget_sweet_spot_min?: number | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          created_by?: string
          finance_tolerance?: string
          genre_bias_list?: string[] | null
          id?: string
          mode_name?: string
          packaging_strength?: string
          series_track_record?: string
          strategic_priorities?: string | null
          streamer_bias_list?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_intelligence_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "production_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          default_role: string
          display_name: string
          email: string
          id: string
          invited_by: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          default_role?: string
          display_name?: string
          email?: string
          id?: string
          invited_by: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          default_role?: string
          display_name?: string
          email?: string
          id?: string
          invited_by?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "production_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_expansions: {
        Row: {
          arc_map: string
          character_bible: string
          created_at: string
          id: string
          pitch_idea_id: string
          production_type: string
          raw_response: Json | null
          tone_doc: string
          treatment: string
          updated_at: string
          user_id: string
          version: number
          world_bible: string
        }
        Insert: {
          arc_map?: string
          character_bible?: string
          created_at?: string
          id?: string
          pitch_idea_id: string
          production_type?: string
          raw_response?: Json | null
          tone_doc?: string
          treatment?: string
          updated_at?: string
          user_id: string
          version?: number
          world_bible?: string
        }
        Update: {
          arc_map?: string
          character_bible?: string
          created_at?: string
          id?: string
          pitch_idea_id?: string
          production_type?: string
          raw_response?: Json | null
          tone_doc?: string
          treatment?: string
          updated_at?: string
          user_id?: string
          version?: number
          world_bible?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_expansions_pitch_idea_id_fkey"
            columns: ["pitch_idea_id"]
            isOneToOne: false
            referencedRelation: "pitch_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_lock_documents: {
        Row: {
          content: string
          created_at: string
          doc_type: string
          id: string
          pitch_idea_id: string
          project_id: string
          title: string
          user_id: string
          version: number
        }
        Insert: {
          content?: string
          created_at?: string
          doc_type?: string
          id?: string
          pitch_idea_id: string
          project_id: string
          title?: string
          user_id: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          doc_type?: string
          id?: string
          pitch_idea_id?: string
          project_id?: string
          title?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "concept_lock_documents_pitch_idea_id_fkey"
            columns: ["pitch_idea_id"]
            isOneToOne: false
            referencedRelation: "pitch_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_lock_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_lock_versions: {
        Row: {
          expansion_id: string | null
          id: string
          locked_at: string
          locked_fields: Json
          pitch_idea_id: string
          stress_test_id: string | null
          unlock_reason: string | null
          unlocked_at: string | null
          user_id: string
          version: number
        }
        Insert: {
          expansion_id?: string | null
          id?: string
          locked_at?: string
          locked_fields?: Json
          pitch_idea_id: string
          stress_test_id?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          user_id: string
          version?: number
        }
        Update: {
          expansion_id?: string | null
          id?: string
          locked_at?: string
          locked_fields?: Json
          pitch_idea_id?: string
          stress_test_id?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "concept_lock_versions_expansion_id_fkey"
            columns: ["expansion_id"]
            isOneToOne: false
            referencedRelation: "concept_expansions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_lock_versions_pitch_idea_id_fkey"
            columns: ["pitch_idea_id"]
            isOneToOne: false
            referencedRelation: "pitch_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_lock_versions_stress_test_id_fkey"
            columns: ["stress_test_id"]
            isOneToOne: false
            referencedRelation: "concept_stress_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_stress_tests: {
        Row: {
          created_at: string
          details: Json | null
          expansion_id: string
          id: string
          passed: boolean
          score_creative_structure: number
          score_engine_sustainability: number
          score_market_alignment: number
          score_total: number
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          expansion_id: string
          id?: string
          passed?: boolean
          score_creative_structure?: number
          score_engine_sustainability?: number
          score_market_alignment?: number
          score_total?: number
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          expansion_id?: string
          id?: string
          passed?: boolean
          score_creative_structure?: number
          score_engine_sustainability?: number
          score_market_alignment?: number
          score_total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_stress_tests_expansion_id_fkey"
            columns: ["expansion_id"]
            isOneToOne: false
            referencedRelation: "concept_expansions"
            referencedColumns: ["id"]
          },
        ]
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
      corpus_character_profiles: {
        Row: {
          arc_type: string | null
          character_name: string | null
          corpus_script_id: string
          created_at: string | null
          dialogue_ratio: number | null
          id: string
          protagonist_flag: boolean | null
          user_id: string
        }
        Insert: {
          arc_type?: string | null
          character_name?: string | null
          corpus_script_id: string
          created_at?: string | null
          dialogue_ratio?: number | null
          id?: string
          protagonist_flag?: boolean | null
          user_id: string
        }
        Update: {
          arc_type?: string | null
          character_name?: string | null
          corpus_script_id?: string
          created_at?: string | null
          dialogue_ratio?: number | null
          id?: string
          protagonist_flag?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_character_profiles_corpus_script_id_fkey"
            columns: ["corpus_script_id"]
            isOneToOne: false
            referencedRelation: "corpus_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          embedding: string | null
          embedding_model: string | null
          embedding_status: string | null
          embedding_updated_at: string | null
          id: string
          script_id: string
          search_vector: unknown
          user_id: string
        }
        Insert: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_status?: string | null
          embedding_updated_at?: string | null
          id?: string
          script_id: string
          search_vector?: unknown
          user_id: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_status?: string | null
          embedding_updated_at?: string | null
          id?: string
          script_id?: string
          search_vector?: unknown
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_chunks_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "corpus_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_derived_artifacts: {
        Row: {
          artifact_type: string
          created_at: string
          id: string
          json_data: Json
          script_id: string
          user_id: string
        }
        Insert: {
          artifact_type?: string
          created_at?: string
          id?: string
          json_data?: Json
          script_id: string
          user_id: string
        }
        Update: {
          artifact_type?: string
          created_at?: string
          id?: string
          json_data?: Json
          script_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_derived_artifacts_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "corpus_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_insights: {
        Row: {
          created_at: string | null
          id: string
          insight_type: string
          lane: string | null
          pattern: Json | null
          production_type: string | null
          user_id: string
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          insight_type: string
          lane?: string | null
          pattern?: Json | null
          production_type?: string | null
          user_id: string
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          insight_type?: string
          lane?: string | null
          pattern?: Json | null
          production_type?: string | null
          user_id?: string
          weight?: number | null
        }
        Relationships: []
      }
      corpus_scene_patterns: {
        Row: {
          act_estimate: number | null
          conflict_type: string | null
          corpus_script_id: string
          created_at: string | null
          has_turn: boolean | null
          id: string
          scene_length_est: number | null
          scene_number: number | null
          user_id: string
        }
        Insert: {
          act_estimate?: number | null
          conflict_type?: string | null
          corpus_script_id: string
          created_at?: string | null
          has_turn?: boolean | null
          id?: string
          scene_length_est?: number | null
          scene_number?: number | null
          user_id: string
        }
        Update: {
          act_estimate?: number | null
          conflict_type?: string | null
          corpus_script_id?: string
          created_at?: string | null
          has_turn?: boolean | null
          id?: string
          scene_length_est?: number | null
          scene_number?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_scene_patterns_corpus_script_id_fkey"
            columns: ["corpus_script_id"]
            isOneToOne: false
            referencedRelation: "corpus_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_scenes: {
        Row: {
          created_at: string
          id: string
          location: string
          scene_number: number
          scene_text: string
          script_id: string
          slugline: string
          time_of_day: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string
          scene_number?: number
          scene_text?: string
          script_id: string
          slugline?: string
          time_of_day?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string
          scene_number?: number
          scene_text?: string
          script_id?: string
          slugline?: string
          time_of_day?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_scenes_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "corpus_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_scripts: {
        Row: {
          analysis_status: string | null
          avg_dialogue_ratio: number | null
          avg_scene_length: number | null
          budget_tier_est: string | null
          cast_count: number | null
          checksum: string
          clean_word_count: number | null
          climax_position: number | null
          created_at: string
          day_night_ratio: number | null
          exclude_from_baselines: boolean | null
          format_subtype: string | null
          genre: string | null
          gold_flag: boolean
          id: string
          ingestion_log: string
          ingestion_source: string | null
          ingestion_status: string
          int_ext_ratio: number | null
          is_transcript: boolean | null
          is_truncated: boolean | null
          line_count: number | null
          location_count: number | null
          market_success_flag: boolean | null
          midpoint_position: number | null
          normalization_removed_lines: number | null
          normalized_page_est: number | null
          page_count: number | null
          page_count_estimate: number | null
          parse_confidence: number | null
          parsed_storage_path: string
          production_type: string | null
          quality_score_est: number | null
          raw_page_est: number | null
          raw_storage_path: string
          raw_text_length_chars: number | null
          runtime_est: number | null
          scene_count: number | null
          source_id: string
          subgenre: string | null
          title: string | null
          transcript_confidence: number | null
          truncation_reason: string | null
          updated_at: string
          user_id: string
          vfx_flag: boolean | null
          word_count: number | null
        }
        Insert: {
          analysis_status?: string | null
          avg_dialogue_ratio?: number | null
          avg_scene_length?: number | null
          budget_tier_est?: string | null
          cast_count?: number | null
          checksum?: string
          clean_word_count?: number | null
          climax_position?: number | null
          created_at?: string
          day_night_ratio?: number | null
          exclude_from_baselines?: boolean | null
          format_subtype?: string | null
          genre?: string | null
          gold_flag?: boolean
          id?: string
          ingestion_log?: string
          ingestion_source?: string | null
          ingestion_status?: string
          int_ext_ratio?: number | null
          is_transcript?: boolean | null
          is_truncated?: boolean | null
          line_count?: number | null
          location_count?: number | null
          market_success_flag?: boolean | null
          midpoint_position?: number | null
          normalization_removed_lines?: number | null
          normalized_page_est?: number | null
          page_count?: number | null
          page_count_estimate?: number | null
          parse_confidence?: number | null
          parsed_storage_path?: string
          production_type?: string | null
          quality_score_est?: number | null
          raw_page_est?: number | null
          raw_storage_path?: string
          raw_text_length_chars?: number | null
          runtime_est?: number | null
          scene_count?: number | null
          source_id: string
          subgenre?: string | null
          title?: string | null
          transcript_confidence?: number | null
          truncation_reason?: string | null
          updated_at?: string
          user_id: string
          vfx_flag?: boolean | null
          word_count?: number | null
        }
        Update: {
          analysis_status?: string | null
          avg_dialogue_ratio?: number | null
          avg_scene_length?: number | null
          budget_tier_est?: string | null
          cast_count?: number | null
          checksum?: string
          clean_word_count?: number | null
          climax_position?: number | null
          created_at?: string
          day_night_ratio?: number | null
          exclude_from_baselines?: boolean | null
          format_subtype?: string | null
          genre?: string | null
          gold_flag?: boolean
          id?: string
          ingestion_log?: string
          ingestion_source?: string | null
          ingestion_status?: string
          int_ext_ratio?: number | null
          is_transcript?: boolean | null
          is_truncated?: boolean | null
          line_count?: number | null
          location_count?: number | null
          market_success_flag?: boolean | null
          midpoint_position?: number | null
          normalization_removed_lines?: number | null
          normalized_page_est?: number | null
          page_count?: number | null
          page_count_estimate?: number | null
          parse_confidence?: number | null
          parsed_storage_path?: string
          production_type?: string | null
          quality_score_est?: number | null
          raw_page_est?: number | null
          raw_storage_path?: string
          raw_text_length_chars?: number | null
          runtime_est?: number | null
          scene_count?: number | null
          source_id?: string
          subgenre?: string | null
          title?: string | null
          transcript_confidence?: number | null
          truncation_reason?: string | null
          updated_at?: string
          user_id?: string
          vfx_flag?: boolean | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "corpus_scripts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "approved_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_benchmark_runs: {
        Row: {
          benchmark_id: string
          coverage_run_id: string
          created_at: string
          created_by: string | null
          id: string
          model: string
          prompt_version_id: string
          scores: Json
        }
        Insert: {
          benchmark_id: string
          coverage_run_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          model: string
          prompt_version_id: string
          scores?: Json
        }
        Update: {
          benchmark_id?: string
          coverage_run_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          prompt_version_id?: string
          scores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "coverage_benchmark_runs_benchmark_id_fkey"
            columns: ["benchmark_id"]
            isOneToOne: false
            referencedRelation: "coverage_benchmarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_benchmark_runs_coverage_run_id_fkey"
            columns: ["coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_benchmark_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "coverage_prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_benchmarks: {
        Row: {
          created_at: string
          created_by: string | null
          gold_notes: string | null
          id: string
          must_catch_issues: Json
          name: string
          project_type: string
          script_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          gold_notes?: string | null
          id?: string
          must_catch_issues?: Json
          name: string
          project_type: string
          script_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          gold_notes?: string | null
          id?: string
          must_catch_issues?: Json
          name?: string
          project_type?: string
          script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_benchmarks_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_feedback: {
        Row: {
          accuracy_to_script: number
          actionability: number
          coverage_run_id: string
          created_at: string
          created_by: string
          free_text: string | null
          id: string
          market_realism: number
          overall_usefulness: number
          specificity: number
        }
        Insert: {
          accuracy_to_script?: number
          actionability?: number
          coverage_run_id: string
          created_at?: string
          created_by: string
          free_text?: string | null
          id?: string
          market_realism?: number
          overall_usefulness?: number
          specificity?: number
        }
        Update: {
          accuracy_to_script?: number
          actionability?: number
          coverage_run_id?: string
          created_at?: string
          created_by?: string
          free_text?: string | null
          id?: string
          market_realism?: number
          overall_usefulness?: number
          specificity?: number
        }
        Relationships: [
          {
            foreignKeyName: "coverage_feedback_coverage_run_id_fkey"
            columns: ["coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_feedback_notes: {
        Row: {
          category: string | null
          coverage_run_id: string
          created_at: string
          created_by: string
          id: string
          last_updated_at: string | null
          note_id: string
          note_snapshot: Json | null
          priority: number | null
          reason: string | null
          section: string | null
          tag: string
          user_edit: string | null
          writer_status: string
        }
        Insert: {
          category?: string | null
          coverage_run_id: string
          created_at?: string
          created_by: string
          id?: string
          last_updated_at?: string | null
          note_id: string
          note_snapshot?: Json | null
          priority?: number | null
          reason?: string | null
          section?: string | null
          tag: string
          user_edit?: string | null
          writer_status?: string
        }
        Update: {
          category?: string | null
          coverage_run_id?: string
          created_at?: string
          created_by?: string
          id?: string
          last_updated_at?: string | null
          note_id?: string
          note_snapshot?: Json | null
          priority?: number | null
          reason?: string | null
          section?: string | null
          tag?: string
          user_edit?: string | null
          writer_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_feedback_notes_coverage_run_id_fkey"
            columns: ["coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_note_comments: {
        Row: {
          comment: string
          created_at: string
          created_by: string
          id: string
          thread_id: string
        }
        Insert: {
          comment: string
          created_at?: string
          created_by: string
          id?: string
          thread_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          created_by?: string
          id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_note_comments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "coverage_note_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_note_threads: {
        Row: {
          coverage_run_id: string
          created_at: string
          created_by: string
          id: string
          note_id: string
        }
        Insert: {
          coverage_run_id: string
          created_at?: string
          created_by: string
          id?: string
          note_id: string
        }
        Update: {
          coverage_run_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_note_threads_coverage_run_id_fkey"
            columns: ["coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_prompt_versions: {
        Row: {
          analyst_prompt: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          output_contract: Json
          producer_prompt: string
          project_type_scope: string[]
          qc_prompt: string
          status: string
        }
        Insert: {
          analyst_prompt: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          output_contract?: Json
          producer_prompt: string
          project_type_scope?: string[]
          qc_prompt: string
          status?: string
        }
        Update: {
          analyst_prompt?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          output_contract?: Json
          producer_prompt?: string
          project_type_scope?: string[]
          qc_prompt?: string
          status?: string
        }
        Relationships: []
      }
      coverage_runs: {
        Row: {
          created_at: string
          created_by: string
          draft_label: string
          final_coverage: string
          id: string
          inputs: Json
          lane: string | null
          metrics: Json
          model: string
          pass_a: string
          pass_b: string
          pass_c: string
          project_id: string
          project_type: string
          prompt_version_id: string
          script_id: string
          structured_notes: Json | null
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_label?: string
          final_coverage?: string
          id?: string
          inputs?: Json
          lane?: string | null
          metrics?: Json
          model: string
          pass_a?: string
          pass_b?: string
          pass_c?: string
          project_id: string
          project_type: string
          prompt_version_id: string
          script_id: string
          structured_notes?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_label?: string
          final_coverage?: string
          id?: string
          inputs?: Json
          lane?: string | null
          metrics?: Json
          model?: string
          pass_a?: string
          pass_b?: string
          pass_c?: string
          project_id?: string
          project_type?: string
          prompt_version_id?: string
          script_id?: string
          structured_notes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "coverage_prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_runs_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          created_at: string
          data_staleness_score: number
          description: string
          id: string
          intelligence_layer: string
          last_refresh: string | null
          production_types_supported: string[]
          refresh_frequency: string
          region: string
          reliability_score: number
          source_name: string
          source_type: string
          status: string
          updated_at: string
          volatility_score: number
        }
        Insert: {
          created_at?: string
          data_staleness_score?: number
          description?: string
          id?: string
          intelligence_layer?: string
          last_refresh?: string | null
          production_types_supported?: string[]
          refresh_frequency?: string
          region?: string
          reliability_score?: number
          source_name: string
          source_type?: string
          status?: string
          updated_at?: string
          volatility_score?: number
        }
        Update: {
          created_at?: string
          data_staleness_score?: number
          description?: string
          id?: string
          intelligence_layer?: string
          last_refresh?: string | null
          production_types_supported?: string[]
          refresh_frequency?: string
          region?: string
          reliability_score?: number
          source_name?: string
          source_type?: string
          status?: string
          updated_at?: string
          volatility_score?: number
        }
        Relationships: []
      }
      development_briefs: {
        Row: {
          audience_demo: string | null
          budget_band: string | null
          created_at: string
          genre: string
          id: string
          lane_preference: string | null
          name: string
          notes: string | null
          platform_target: string | null
          production_type: string
          region: string | null
          risk_appetite: string | null
          status: string
          subgenre: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audience_demo?: string | null
          budget_band?: string | null
          created_at?: string
          genre: string
          id?: string
          lane_preference?: string | null
          name?: string
          notes?: string | null
          platform_target?: string | null
          production_type: string
          region?: string | null
          risk_appetite?: string | null
          status?: string
          subgenre?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audience_demo?: string | null
          budget_band?: string | null
          created_at?: string
          genre?: string
          id?: string
          lane_preference?: string | null
          name?: string
          notes?: string | null
          platform_target?: string | null
          production_type?: string
          region?: string | null
          risk_appetite?: string | null
          status?: string
          subgenre?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      edit_versions: {
        Row: {
          created_at: string
          id: string
          notes: string
          project_id: string
          screening_score: number | null
          user_id: string
          version_label: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string
          project_id: string
          screening_score?: number | null
          user_id: string
          version_label?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          project_id?: string
          screening_score?: number | null
          user_id?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "edit_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_source_map: {
        Row: {
          created_at: string
          engine_id: string
          id: string
          source_id: string
          source_weight: number
          status: string
          updated_at: string
          validation_method: string
        }
        Insert: {
          created_at?: string
          engine_id: string
          id?: string
          source_id: string
          source_weight?: number
          status?: string
          updated_at?: string
          validation_method?: string
        }
        Update: {
          created_at?: string
          engine_id?: string
          id?: string
          source_id?: string
          source_weight?: number
          status?: string
          updated_at?: string
          validation_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_source_map_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "trend_engines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_source_map_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_weight_snapshots: {
        Row: {
          created_at: string
          id: string
          notes: string
          production_type: string
          snapshot_label: string
          trigger_type: string
          weights: Json
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string
          production_type: string
          snapshot_label?: string
          trigger_type?: string
          weights?: Json
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          production_type?: string
          snapshot_label?: string
          trigger_type?: string
          weights?: Json
        }
        Relationships: []
      }
      failure_contrast: {
        Row: {
          active: boolean
          box_office_est: string | null
          budget_est: string | null
          conflict_density: string
          costless_climax: boolean
          created_at: string
          dataset_type: string
          development_outcome: string
          dialogue_subtext_level: string
          flat_escalation: boolean
          format: string
          genre: string
          id: string
          inciting_incident_page: number | null
          late_inciting_incident: boolean
          midpoint_strength: string
          no_midpoint_shift: boolean
          notes: string | null
          on_the_nose_dialogue: boolean
          passive_protagonist: boolean
          primary_weakness: string
          produced: boolean
          protagonist_agency: string
          third_act_strength: string
          title: string
          updated_at: string
          weight: string
          year: number | null
        }
        Insert: {
          active?: boolean
          box_office_est?: string | null
          budget_est?: string | null
          conflict_density?: string
          costless_climax?: boolean
          created_at?: string
          dataset_type?: string
          development_outcome?: string
          dialogue_subtext_level?: string
          flat_escalation?: boolean
          format?: string
          genre: string
          id?: string
          inciting_incident_page?: number | null
          late_inciting_incident?: boolean
          midpoint_strength?: string
          no_midpoint_shift?: boolean
          notes?: string | null
          on_the_nose_dialogue?: boolean
          passive_protagonist?: boolean
          primary_weakness?: string
          produced?: boolean
          protagonist_agency?: string
          third_act_strength?: string
          title: string
          updated_at?: string
          weight?: string
          year?: number | null
        }
        Update: {
          active?: boolean
          box_office_est?: string | null
          budget_est?: string | null
          conflict_density?: string
          costless_climax?: boolean
          created_at?: string
          dataset_type?: string
          development_outcome?: string
          dialogue_subtext_level?: string
          flat_escalation?: boolean
          format?: string
          genre?: string
          id?: string
          inciting_incident_page?: number | null
          late_inciting_incident?: boolean
          midpoint_strength?: string
          no_midpoint_shift?: boolean
          notes?: string | null
          on_the_nose_dialogue?: boolean
          passive_protagonist?: boolean
          primary_weakness?: string
          produced?: boolean
          protagonist_agency?: string
          third_act_strength?: string
          title?: string
          updated_at?: string
          weight?: string
          year?: number | null
        }
        Relationships: []
      }
      format_profiles: {
        Row: {
          created_at: string
          episode_count: number | null
          episode_length_target: number | null
          format_subtype: string
          id: string
          max_page_count: number
          max_runtime_min: number
          min_page_count: number
          min_runtime_min: number
          owner_id: string
          platform_target: string | null
          production_type: string
          project_id: string
          strict_enforcement: boolean
          target_page_count: number
          target_runtime_min: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          episode_count?: number | null
          episode_length_target?: number | null
          format_subtype?: string
          id?: string
          max_page_count?: number
          max_runtime_min?: number
          min_page_count?: number
          min_runtime_min?: number
          owner_id: string
          platform_target?: string | null
          production_type?: string
          project_id: string
          strict_enforcement?: boolean
          target_page_count?: number
          target_runtime_min?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          episode_count?: number | null
          episode_length_target?: number | null
          format_subtype?: string
          id?: string
          max_page_count?: number
          max_runtime_min?: number
          min_page_count?: number
          min_runtime_min?: number
          owner_id?: string
          platform_target?: string | null
          production_type?: string
          project_id?: string
          strict_enforcement?: boolean
          target_page_count?: number
          target_runtime_min?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "format_profiles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      great_notes_library: {
        Row: {
          budget_band: string | null
          created_at: string
          created_by: string
          evidence_style: string | null
          genre: string | null
          id: string
          note_text: string
          problem_type: string
          project_type: string
          source_coverage_run_id: string | null
          tags: string[]
        }
        Insert: {
          budget_band?: string | null
          created_at?: string
          created_by: string
          evidence_style?: string | null
          genre?: string | null
          id?: string
          note_text: string
          problem_type: string
          project_type: string
          source_coverage_run_id?: string | null
          tags?: string[]
        }
        Update: {
          budget_band?: string | null
          created_at?: string
          created_by?: string
          evidence_style?: string | null
          genre?: string | null
          id?: string
          note_text?: string
          problem_type?: string
          project_type?: string
          source_coverage_run_id?: string | null
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "great_notes_library_source_coverage_run_id_fkey"
            columns: ["source_coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      house_style: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          preferences: Json
          style_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          preferences?: Json
          style_name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string | null
          preferences?: Json
          style_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      improvement_runs: {
        Row: {
          after_scores: Json
          after_version_id: string | null
          before_scores: Json
          before_version_id: string | null
          changes_summary: string
          created_at: string
          goal: string
          id: string
          inflation_flag: boolean | null
          inflation_reason: string | null
          intensity: string
          owner_id: string
          playbooks_used: Json
          post_rewrite_breakdown: Json | null
          post_rewrite_viability: number | null
          pre_rewrite_breakdown: Json | null
          pre_rewrite_viability: number | null
          project_id: string
          regression_detected: boolean
          rolled_back: boolean
          scene_ops: Json
          score_deltas: Json
          script_id: string
          status: string
          viability_delta: number | null
        }
        Insert: {
          after_scores?: Json
          after_version_id?: string | null
          before_scores?: Json
          before_version_id?: string | null
          changes_summary?: string
          created_at?: string
          goal?: string
          id?: string
          inflation_flag?: boolean | null
          inflation_reason?: string | null
          intensity?: string
          owner_id: string
          playbooks_used?: Json
          post_rewrite_breakdown?: Json | null
          post_rewrite_viability?: number | null
          pre_rewrite_breakdown?: Json | null
          pre_rewrite_viability?: number | null
          project_id: string
          regression_detected?: boolean
          rolled_back?: boolean
          scene_ops?: Json
          score_deltas?: Json
          script_id: string
          status?: string
          viability_delta?: number | null
        }
        Update: {
          after_scores?: Json
          after_version_id?: string | null
          before_scores?: Json
          before_version_id?: string | null
          changes_summary?: string
          created_at?: string
          goal?: string
          id?: string
          inflation_flag?: boolean | null
          inflation_reason?: string | null
          intensity?: string
          owner_id?: string
          playbooks_used?: Json
          post_rewrite_breakdown?: Json | null
          post_rewrite_viability?: number | null
          pre_rewrite_breakdown?: Json | null
          pre_rewrite_viability?: number | null
          project_id?: string
          regression_detected?: boolean
          rolled_back?: boolean
          scene_ops?: Json
          score_deltas?: Json
          script_id?: string
          status?: string
          viability_delta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "improvement_runs_after_version_id_fkey"
            columns: ["after_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvement_runs_before_version_id_fkey"
            columns: ["before_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvement_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      masterwork_canon: {
        Row: {
          act1_break_pct: number | null
          act2_break_pct: number | null
          active: boolean
          awards_recognition: string
          box_office_tier: string
          budget_tier: string
          character_objective_clarity: string | null
          created_at: string
          dataset_type: string
          dialogue_compression: string | null
          dialogue_density: string
          emotional_layering: string | null
          escalation_pattern: string
          escalation_velocity: string | null
          format: string
          genre: string
          id: string
          inciting_incident_pct: number | null
          midpoint_pct: number | null
          monetisation_lane: string
          scene_purpose_density: string | null
          structural_model: string
          thematic_depth: string
          third_act_type: string
          title: string
          updated_at: string
          weight: string
          year: number
        }
        Insert: {
          act1_break_pct?: number | null
          act2_break_pct?: number | null
          active?: boolean
          awards_recognition?: string
          box_office_tier?: string
          budget_tier?: string
          character_objective_clarity?: string | null
          created_at?: string
          dataset_type?: string
          dialogue_compression?: string | null
          dialogue_density?: string
          emotional_layering?: string | null
          escalation_pattern?: string
          escalation_velocity?: string | null
          format?: string
          genre: string
          id?: string
          inciting_incident_pct?: number | null
          midpoint_pct?: number | null
          monetisation_lane?: string
          scene_purpose_density?: string | null
          structural_model?: string
          thematic_depth?: string
          third_act_type?: string
          title: string
          updated_at?: string
          weight?: string
          year: number
        }
        Update: {
          act1_break_pct?: number | null
          act2_break_pct?: number | null
          active?: boolean
          awards_recognition?: string
          box_office_tier?: string
          budget_tier?: string
          character_objective_clarity?: string | null
          created_at?: string
          dataset_type?: string
          dialogue_compression?: string | null
          dialogue_density?: string
          emotional_layering?: string | null
          escalation_pattern?: string
          escalation_velocity?: string | null
          format?: string
          genre?: string
          id?: string
          inciting_incident_pct?: number | null
          midpoint_pct?: number | null
          monetisation_lane?: string
          scene_purpose_density?: string | null
          structural_model?: string
          thematic_depth?: string
          third_act_type?: string
          title?: string
          updated_at?: string
          weight?: string
          year?: number
        }
        Relationships: []
      }
      model_accuracy_scores: {
        Row: {
          accuracy_pct: number
          avg_actual_outcome: number
          avg_predicted_score: number
          correct_predictions: number
          created_at: string
          engine_id: string | null
          id: string
          last_calculated_at: string
          production_type: string
          total_predictions: number
          updated_at: string
        }
        Insert: {
          accuracy_pct?: number
          avg_actual_outcome?: number
          avg_predicted_score?: number
          correct_predictions?: number
          created_at?: string
          engine_id?: string | null
          id?: string
          last_calculated_at?: string
          production_type?: string
          total_predictions?: number
          updated_at?: string
        }
        Update: {
          accuracy_pct?: number
          avg_actual_outcome?: number
          avg_predicted_score?: number
          correct_predictions?: number
          created_at?: string
          engine_id?: string | null
          id?: string
          last_calculated_at?: string
          production_type?: string
          total_predictions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_accuracy_scores_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "trend_engines"
            referencedColumns: ["id"]
          },
        ]
      }
      model_version_log: {
        Row: {
          change_type: string
          changes: Json
          created_at: string
          id: string
          production_type: string
          reason: string
          triggered_by: string
          version_label: string
        }
        Insert: {
          change_type?: string
          changes?: Json
          created_at?: string
          id?: string
          production_type?: string
          reason?: string
          triggered_by?: string
          version_label?: string
        }
        Update: {
          change_type?: string
          changes?: Json
          created_at?: string
          id?: string
          production_type?: string
          reason?: string
          triggered_by?: string
          version_label?: string
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
      outcome_deltas: {
        Row: {
          actual_budget_range: string | null
          actual_lane: string | null
          budget_achieved: boolean | null
          budget_range_prediction_correct: boolean | null
          commercial_score_delta: number | null
          computed_at: string | null
          development_time_months: number | null
          distribution_offer: boolean | null
          festival_selection: boolean | null
          finance_prediction_correct: boolean | null
          financed: boolean | null
          greenlight_prediction_correct: boolean | null
          id: string
          initial_commercial_score: number | null
          initial_finance_confidence: string | null
          initial_greenlight_verdict: string | null
          initial_structural_score: number | null
          lane_prediction_correct: boolean | null
          notes: Json | null
          predicted_budget_range: string | null
          predicted_lane: string | null
          predicted_to_actual_gap_score: number | null
          presales_secured: boolean | null
          project_id: string
          recoup_achieved: boolean | null
          streamer_interest: boolean | null
          talent_attached: boolean | null
          user_id: string
        }
        Insert: {
          actual_budget_range?: string | null
          actual_lane?: string | null
          budget_achieved?: boolean | null
          budget_range_prediction_correct?: boolean | null
          commercial_score_delta?: number | null
          computed_at?: string | null
          development_time_months?: number | null
          distribution_offer?: boolean | null
          festival_selection?: boolean | null
          finance_prediction_correct?: boolean | null
          financed?: boolean | null
          greenlight_prediction_correct?: boolean | null
          id?: string
          initial_commercial_score?: number | null
          initial_finance_confidence?: string | null
          initial_greenlight_verdict?: string | null
          initial_structural_score?: number | null
          lane_prediction_correct?: boolean | null
          notes?: Json | null
          predicted_budget_range?: string | null
          predicted_lane?: string | null
          predicted_to_actual_gap_score?: number | null
          presales_secured?: boolean | null
          project_id: string
          recoup_achieved?: boolean | null
          streamer_interest?: boolean | null
          talent_attached?: boolean | null
          user_id: string
        }
        Update: {
          actual_budget_range?: string | null
          actual_lane?: string | null
          budget_achieved?: boolean | null
          budget_range_prediction_correct?: boolean | null
          commercial_score_delta?: number | null
          computed_at?: string | null
          development_time_months?: number | null
          distribution_offer?: boolean | null
          festival_selection?: boolean | null
          finance_prediction_correct?: boolean | null
          financed?: boolean | null
          greenlight_prediction_correct?: boolean | null
          id?: string
          initial_commercial_score?: number | null
          initial_finance_confidence?: string | null
          initial_greenlight_verdict?: string | null
          initial_structural_score?: number | null
          lane_prediction_correct?: boolean | null
          notes?: Json | null
          predicted_budget_range?: string | null
          predicted_lane?: string | null
          predicted_to_actual_gap_score?: number | null
          presales_secured?: boolean | null
          project_id?: string
          recoup_achieved?: boolean | null
          streamer_interest?: boolean | null
          talent_attached?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_deltas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_signals: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          payload: Json
          project_id: string
          script_version_id: string | null
          signal_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          payload?: Json
          project_id: string
          script_version_id?: string | null
          signal_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          payload?: Json
          project_id?: string
          script_version_id?: string | null
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_signals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_signals_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_items: {
        Row: {
          archetype: string | null
          created_at: string
          id: string
          item_type: string
          name: string | null
          notes: string | null
          priority: number | null
          project_id: string
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archetype?: string | null
          created_at?: string
          id?: string
          item_type?: string
          name?: string | null
          notes?: string | null
          priority?: number | null
          project_id: string
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archetype?: string | null
          created_at?: string
          id?: string
          item_type?: string
          name?: string | null
          notes?: string | null
          priority?: number | null
          project_id?: string
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pitch_feedback: {
        Row: {
          created_at: string
          direction: string | null
          id: string
          pitch_idea_id: string
          rating: string
          tags: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          direction?: string | null
          id?: string
          pitch_idea_id: string
          rating: string
          tags?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string | null
          id?: string
          pitch_idea_id?: string
          rating?: string
          tags?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitch_feedback_pitch_idea_id_fkey"
            columns: ["pitch_idea_id"]
            isOneToOne: false
            referencedRelation: "pitch_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      pitch_ideas: {
        Row: {
          brief_id: string | null
          budget_band: string
          comps: string[]
          concept_lock_status: string
          concept_lock_version: number
          created_at: string
          development_sprint: Json
          genre: string
          id: string
          lane_confidence: number
          logline: string
          mode: string
          one_page_pitch: string
          packaging_suggestions: Json
          platform_target: string
          production_type: string
          project_id: string | null
          promoted_to_project_id: string | null
          raw_response: Json | null
          recommended_lane: string
          region: string
          risk_level: string
          risks_mitigations: Json
          score_company_fit: number | null
          score_feasibility: number | null
          score_lane_fit: number | null
          score_market_heat: number | null
          score_saturation_risk: number | null
          score_total: number | null
          source_coverage_run_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          why_us: string
        }
        Insert: {
          brief_id?: string | null
          budget_band?: string
          comps?: string[]
          concept_lock_status?: string
          concept_lock_version?: number
          created_at?: string
          development_sprint?: Json
          genre?: string
          id?: string
          lane_confidence?: number
          logline?: string
          mode?: string
          one_page_pitch?: string
          packaging_suggestions?: Json
          platform_target?: string
          production_type?: string
          project_id?: string | null
          promoted_to_project_id?: string | null
          raw_response?: Json | null
          recommended_lane?: string
          region?: string
          risk_level?: string
          risks_mitigations?: Json
          score_company_fit?: number | null
          score_feasibility?: number | null
          score_lane_fit?: number | null
          score_market_heat?: number | null
          score_saturation_risk?: number | null
          score_total?: number | null
          source_coverage_run_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          why_us?: string
        }
        Update: {
          brief_id?: string | null
          budget_band?: string
          comps?: string[]
          concept_lock_status?: string
          concept_lock_version?: number
          created_at?: string
          development_sprint?: Json
          genre?: string
          id?: string
          lane_confidence?: number
          logline?: string
          mode?: string
          one_page_pitch?: string
          packaging_suggestions?: Json
          platform_target?: string
          production_type?: string
          project_id?: string | null
          promoted_to_project_id?: string | null
          raw_response?: Json | null
          recommended_lane?: string
          region?: string
          risk_level?: string
          risks_mitigations?: Json
          score_company_fit?: number | null
          score_feasibility?: number | null
          score_lane_fit?: number | null
          score_market_heat?: number | null
          score_saturation_risk?: number | null
          score_total?: number | null
          source_coverage_run_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          why_us?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitch_ideas_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "development_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_ideas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_ideas_promoted_to_project_id_fkey"
            columns: ["promoted_to_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_ideas_source_coverage_run_id_fkey"
            columns: ["source_coverage_run_id"]
            isOneToOne: false
            referencedRelation: "coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      post_milestones: {
        Row: {
          completed_date: string | null
          created_at: string
          due_date: string | null
          id: string
          label: string
          milestone_type: string
          notes: string
          project_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          milestone_type?: string
          notes?: string
          project_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          milestone_type?: string
          notes?: string
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_outcomes: {
        Row: {
          actual_financing_outcome: string
          created_at: string
          distribution_type: string
          id: string
          notes: string
          outcome_recorded_at: string | null
          predicted_at: string
          predicted_viability: number
          project_id: string
          revenue_if_known: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_financing_outcome?: string
          created_at?: string
          distribution_type?: string
          id?: string
          notes?: string
          outcome_recorded_at?: string | null
          predicted_at?: string
          predicted_viability?: number
          project_id: string
          revenue_if_known?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_financing_outcome?: string
          created_at?: string
          distribution_type?: string
          id?: string
          notes?: string
          outcome_recorded_at?: string | null
          predicted_at?: string
          predicted_viability?: number
          project_id?: string
          revenue_if_known?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_outcomes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_companies: {
        Row: {
          color_accent: string
          created_at: string
          id: string
          jurisdiction: string
          logo_url: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_accent?: string
          created_at?: string
          id?: string
          jurisdiction?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_accent?: string
          created_at?: string
          id?: string
          jurisdiction?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      production_cost_actuals: {
        Row: {
          actual: number
          budgeted: number
          created_at: string
          department: string
          id: string
          notes: string
          project_id: string
          updated_at: string
          user_id: string
          variance: number | null
          variance_pct: number | null
        }
        Insert: {
          actual?: number
          budgeted?: number
          created_at?: string
          department?: string
          id?: string
          notes?: string
          project_id: string
          updated_at?: string
          user_id: string
          variance?: number | null
          variance_pct?: number | null
        }
        Update: {
          actual?: number
          budgeted?: number
          created_at?: string
          department?: string
          id?: string
          notes?: string
          project_id?: string
          updated_at?: string
          user_id?: string
          variance?: number | null
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_cost_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_daily_reports: {
        Row: {
          call_time: string
          created_at: string
          id: string
          incident_severity: string
          incidents: string
          notes: string
          pages_shot: number
          project_id: string
          report_date: string
          scenes_shot: number
          setup_count: number
          updated_at: string
          user_id: string
          weather: string
          wrap_time: string
        }
        Insert: {
          call_time?: string
          created_at?: string
          id?: string
          incident_severity?: string
          incidents?: string
          notes?: string
          pages_shot?: number
          project_id: string
          report_date: string
          scenes_shot?: number
          setup_count?: number
          updated_at?: string
          user_id: string
          weather?: string
          wrap_time?: string
        }
        Update: {
          call_time?: string
          created_at?: string
          id?: string
          incident_severity?: string
          incidents?: string
          notes?: string
          pages_shot?: number
          project_id?: string
          report_date?: string
          scenes_shot?: number
          setup_count?: number
          updated_at?: string
          user_id?: string
          weather?: string
          wrap_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      production_engine_weights: {
        Row: {
          created_at: string
          engine_id: string
          id: string
          production_type: string
          updated_at: string
          weight_value: number
        }
        Insert: {
          created_at?: string
          engine_id: string
          id?: string
          production_type: string
          updated_at?: string
          weight_value?: number
        }
        Update: {
          created_at?: string
          engine_id?: string
          id?: string
          production_type?: string
          updated_at?: string
          weight_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_engine_weights_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "trend_engines"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          mode_preference: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          mode_preference?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          mode_preference?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_activity_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          project_id: string
          section: string
          summary: string
          user_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          project_id: string
          section?: string
          summary?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          project_id?: string
          section?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_baselines: {
        Row: {
          budget_confidence: number | null
          id: string
          internal_commercial_tier: string | null
          internal_confidence: number | null
          notes: string | null
          packaging_confidence: number | null
          paradox_exec_confidence: number | null
          paradox_mode_flags: Json | null
          project_id: string
          recorded_at: string
          user_id: string
          would_pursue: boolean | null
        }
        Insert: {
          budget_confidence?: number | null
          id?: string
          internal_commercial_tier?: string | null
          internal_confidence?: number | null
          notes?: string | null
          packaging_confidence?: number | null
          paradox_exec_confidence?: number | null
          paradox_mode_flags?: Json | null
          project_id: string
          recorded_at?: string
          user_id?: string
          would_pursue?: boolean | null
        }
        Update: {
          budget_confidence?: number | null
          id?: string
          internal_commercial_tier?: string | null
          internal_confidence?: number | null
          notes?: string | null
          packaging_confidence?: number | null
          paradox_exec_confidence?: number | null
          paradox_mode_flags?: Json | null
          project_id?: string
          recorded_at?: string
          user_id?: string
          would_pursue?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "project_baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budget_lines: {
        Row: {
          amount: number
          budget_id: string
          category: string
          created_at: string
          id: string
          line_name: string
          notes: string
          project_id: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          budget_id: string
          category?: string
          created_at?: string
          id?: string
          line_name?: string
          notes?: string
          project_id: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          budget_id?: string
          category?: string
          created_at?: string
          id?: string
          line_name?: string
          notes?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "project_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budgets: {
        Row: {
          created_at: string
          currency: string
          id: string
          lane_template: string
          notes: string
          project_id: string
          source: string
          status: string
          total_amount: number
          updated_at: string
          user_id: string
          version_label: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          lane_template?: string
          notes?: string
          project_id: string
          source?: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id: string
          version_label?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          lane_template?: string
          notes?: string
          project_id?: string
          source?: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cashflow_sources: {
        Row: {
          amount: number
          created_at: string
          duration_months: number
          id: string
          name: string
          origin: string
          origin_ref_id: string | null
          project_id: string
          sort_order: number
          source_type: string
          start_month: number
          timing: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          duration_months?: number
          id?: string
          name?: string
          origin?: string
          origin_ref_id?: string | null
          project_id: string
          sort_order?: number
          source_type?: string
          start_month?: number
          timing?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          duration_months?: number
          id?: string
          name?: string
          origin?: string
          origin_ref_id?: string | null
          project_id?: string
          sort_order?: number
          source_type?: string
          start_month?: number
          timing?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cashflow_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cast: {
        Row: {
          actor_name: string
          agency: string
          agent_name: string
          contact_email: string
          contact_phone: string
          created_at: string
          id: string
          imdb_id: string
          manager_name: string
          market_value_tier: string
          notes: string
          project_id: string
          role_name: string
          status: string
          territory_tags: string[]
          tmdb_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_name?: string
          agency?: string
          agent_name?: string
          contact_email?: string
          contact_phone?: string
          created_at?: string
          id?: string
          imdb_id?: string
          manager_name?: string
          market_value_tier?: string
          notes?: string
          project_id: string
          role_name?: string
          status?: string
          territory_tags?: string[]
          tmdb_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_name?: string
          agency?: string
          agent_name?: string
          contact_email?: string
          contact_phone?: string
          created_at?: string
          id?: string
          imdb_id?: string
          manager_name?: string
          market_value_tier?: string
          notes?: string
          project_id?: string
          role_name?: string
          status?: string
          territory_tags?: string[]
          tmdb_id?: string
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
      project_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_chat_messages_project_id_fkey"
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
      project_company_links: {
        Row: {
          company_id: string
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_company_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "production_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_company_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_contracts: {
        Row: {
          contract_type: string
          created_at: string
          currency: string
          executed_at: string | null
          expires_at: string | null
          id: string
          key_terms: Json
          notes: string
          participant_id: string | null
          project_id: string
          rights_granted: string
          source: string
          status: string
          term_years: string
          territory: string
          title: string
          total_value: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          contract_type?: string
          created_at?: string
          currency?: string
          executed_at?: string | null
          expires_at?: string | null
          id?: string
          key_terms?: Json
          notes?: string
          participant_id?: string | null
          project_id: string
          rights_granted?: string
          source?: string
          status?: string
          term_years?: string
          territory?: string
          title?: string
          total_value?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          contract_type?: string
          created_at?: string
          currency?: string
          executed_at?: string | null
          expires_at?: string | null
          id?: string
          key_terms?: Json
          notes?: string
          participant_id?: string | null
          project_id?: string
          rights_granted?: string
          source?: string
          status?: string
          term_years?: string
          territory?: string
          title?: string
          total_value?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_contracts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "project_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contracts_project_id_fkey"
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
      project_cost_entries: {
        Row: {
          amount: number
          budget_id: string | null
          category: string
          created_at: string
          description: string
          entry_date: string
          id: string
          notes: string
          project_id: string
          receipt_ref: string
          updated_at: string
          user_id: string
          vendor: string
        }
        Insert: {
          amount?: number
          budget_id?: string | null
          category?: string
          created_at?: string
          description?: string
          entry_date?: string
          id?: string
          notes?: string
          project_id: string
          receipt_ref?: string
          updated_at?: string
          user_id: string
          vendor?: string
        }
        Update: {
          amount?: number
          budget_id?: string | null
          category?: string
          created_at?: string
          description?: string
          entry_date?: string
          id?: string
          notes?: string
          project_id?: string
          receipt_ref?: string
          updated_at?: string
          user_id?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cost_entries_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "project_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cost_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_deadlines: {
        Row: {
          completed: boolean
          created_at: string
          deadline_type: string
          due_date: string
          id: string
          label: string
          notes: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          deadline_type?: string
          due_date: string
          id?: string
          label?: string
          notes?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          deadline_type?: string
          due_date?: string
          id?: string
          label?: string
          notes?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_deadlines_project_id_fkey"
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
      project_decisions: {
        Row: {
          context: string
          created_at: string
          decided_at: string
          decision: string
          decision_type: string
          id: string
          outcome: string
          project_id: string
          reasoning: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context?: string
          created_at?: string
          decided_at?: string
          decision?: string
          decision_type?: string
          id?: string
          outcome?: string
          project_id: string
          reasoning?: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context?: string
          created_at?: string
          decided_at?: string
          decision?: string
          decision_type?: string
          id?: string
          outcome?: string
          project_id?: string
          reasoning?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_deliverables: {
        Row: {
          buyer_name: string
          created_at: string
          deliverable_type: string
          due_date: string | null
          format_spec: string
          id: string
          item_name: string
          notes: string
          project_id: string
          rights_window: string
          status: string
          territory: string
          updated_at: string
          user_id: string
        }
        Insert: {
          buyer_name?: string
          created_at?: string
          deliverable_type?: string
          due_date?: string | null
          format_spec?: string
          id?: string
          item_name?: string
          notes?: string
          project_id: string
          rights_window?: string
          status?: string
          territory?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          buyer_name?: string
          created_at?: string
          deliverable_type?: string
          due_date?: string | null
          format_spec?: string
          id?: string
          item_name?: string
          notes?: string
          project_id?: string
          rights_window?: string
          status?: string
          territory?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_deliverables_project_id_fkey"
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
      project_engine_scores: {
        Row: {
          confidence: string
          created_at: string
          engine_id: string
          id: string
          last_scored_at: string
          notes: string
          project_id: string
          score: number
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          engine_id: string
          id?: string
          last_scored_at?: string
          notes?: string
          project_id: string
          score?: number
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          engine_id?: string
          id?: string
          last_scored_at?: string
          notes?: string
          project_id?: string
          score?: number
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_engine_scores_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "trend_engines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_engine_scores_project_id_fkey"
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
          agency: string
          agent_name: string
          contact_email: string
          contact_phone: string
          created_at: string
          department: string
          id: string
          imdb_id: string
          known_for: string
          manager_name: string
          notes: string
          person_name: string
          project_id: string
          reputation_tier: string
          status: string
          tmdb_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agency?: string
          agent_name?: string
          contact_email?: string
          contact_phone?: string
          created_at?: string
          department?: string
          id?: string
          imdb_id?: string
          known_for?: string
          manager_name?: string
          notes?: string
          person_name?: string
          project_id: string
          reputation_tier?: string
          status?: string
          tmdb_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agency?: string
          agent_name?: string
          contact_email?: string
          contact_phone?: string
          created_at?: string
          department?: string
          id?: string
          imdb_id?: string
          known_for?: string
          manager_name?: string
          notes?: string
          person_name?: string
          project_id?: string
          reputation_tier?: string
          status?: string
          tmdb_id?: string
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
      project_outcomes: {
        Row: {
          budget_achieved: boolean | null
          budget_secured_amount: number | null
          development_time_months: number | null
          distribution_offer: boolean
          festival_selection: boolean
          financed: boolean
          id: string
          initial_commercial_score: number | null
          initial_finance_confidence: string | null
          initial_greenlight_verdict: string | null
          initial_structural_score: number | null
          notes: string | null
          optioned: boolean
          presales_secured: boolean | null
          project_id: string
          recorded_at: string
          recoup_achieved: boolean
          soft_money_secured: boolean
          streamer_interest: boolean
          talent_attached: boolean
          user_id: string
        }
        Insert: {
          budget_achieved?: boolean | null
          budget_secured_amount?: number | null
          development_time_months?: number | null
          distribution_offer?: boolean
          festival_selection?: boolean
          financed?: boolean
          id?: string
          initial_commercial_score?: number | null
          initial_finance_confidence?: string | null
          initial_greenlight_verdict?: string | null
          initial_structural_score?: number | null
          notes?: string | null
          optioned?: boolean
          presales_secured?: boolean | null
          project_id: string
          recorded_at?: string
          recoup_achieved?: boolean
          soft_money_secured?: boolean
          streamer_interest?: boolean
          talent_attached?: boolean
          user_id?: string
        }
        Update: {
          budget_achieved?: boolean | null
          budget_secured_amount?: number | null
          development_time_months?: number | null
          distribution_offer?: boolean
          festival_selection?: boolean
          financed?: boolean
          id?: string
          initial_commercial_score?: number | null
          initial_finance_confidence?: string | null
          initial_greenlight_verdict?: string | null
          initial_structural_score?: number | null
          notes?: string | null
          optioned?: boolean
          presales_secured?: boolean | null
          project_id?: string
          recorded_at?: string
          recoup_achieved?: boolean
          soft_money_secured?: boolean
          streamer_interest?: boolean
          talent_attached?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_outcomes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_ownership_stakes: {
        Row: {
          conditions: string
          contract_id: string | null
          created_at: string
          id: string
          notes: string
          participant_id: string | null
          percentage: number
          project_id: string
          rights_type: string
          source: string
          stake_type: string
          territory: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          conditions?: string
          contract_id?: string | null
          created_at?: string
          id?: string
          notes?: string
          participant_id?: string | null
          percentage?: number
          project_id: string
          rights_type?: string
          source?: string
          stake_type?: string
          territory?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          conditions?: string
          contract_id?: string | null
          created_at?: string
          id?: string
          notes?: string
          participant_id?: string | null
          percentage?: number
          project_id?: string
          rights_type?: string
          source?: string
          stake_type?: string
          territory?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_ownership_stakes_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "project_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_ownership_stakes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "project_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_ownership_stakes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_participants: {
        Row: {
          company: string
          contact_email: string
          created_at: string
          id: string
          notes: string
          participant_name: string
          participant_type: string
          project_id: string
          role_description: string
          source: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          company?: string
          contact_email?: string
          created_at?: string
          id?: string
          notes?: string
          participant_name?: string
          participant_type?: string
          project_id: string
          role_description?: string
          source?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          company?: string
          contact_email?: string
          created_at?: string
          id?: string
          notes?: string
          participant_name?: string
          participant_type?: string
          project_id?: string
          role_description?: string
          source?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_participants_project_id_fkey"
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
      project_preferences: {
        Row: {
          id: string
          owner_id: string
          prefs: Json
          project_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          prefs?: Json
          project_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          prefs?: Json
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_preferences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_recoupment_scenarios: {
        Row: {
          created_at: string
          currency: string
          id: string
          notes: string
          project_id: string
          scenario_name: string
          total_revenue_estimate: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          notes?: string
          project_id: string
          scenario_name?: string
          total_revenue_estimate?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          notes?: string
          project_id?: string
          scenario_name?: string
          total_revenue_estimate?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_recoupment_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_recoupment_tiers: {
        Row: {
          cap: number | null
          created_at: string
          fixed_amount: number
          id: string
          notes: string
          participant_name: string
          percentage: number
          project_id: string
          scenario_id: string
          tier_order: number
          tier_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cap?: number | null
          created_at?: string
          fixed_amount?: number
          id?: string
          notes?: string
          participant_name?: string
          percentage?: number
          project_id: string
          scenario_id: string
          tier_order?: number
          tier_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cap?: number | null
          created_at?: string
          fixed_amount?: number
          id?: string
          notes?: string
          participant_name?: string
          percentage?: number
          project_id?: string
          scenario_id?: string
          tier_order?: number
          tier_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_recoupment_tiers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_recoupment_tiers_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "project_recoupment_scenarios"
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
      project_waterfall_rules: {
        Row: {
          cap_amount: string
          conditions: string
          contract_id: string | null
          corridor_pct: number
          created_at: string
          id: string
          notes: string
          participant_id: string | null
          percentage: number
          position: number
          premium_pct: number
          project_id: string
          rule_name: string
          rule_type: string
          source: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          cap_amount?: string
          conditions?: string
          contract_id?: string | null
          corridor_pct?: number
          created_at?: string
          id?: string
          notes?: string
          participant_id?: string | null
          percentage?: number
          position?: number
          premium_pct?: number
          project_id: string
          rule_name?: string
          rule_type?: string
          source?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          cap_amount?: string
          conditions?: string
          contract_id?: string | null
          corridor_pct?: number
          created_at?: string
          id?: string
          notes?: string
          participant_id?: string | null
          percentage?: number
          position?: number
          premium_pct?: number
          project_id?: string
          rule_name?: string
          rule_type?: string
          source?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_waterfall_rules_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "project_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_waterfall_rules_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "project_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_waterfall_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          active_company_profile_id: string | null
          analysis_passes: Json | null
          assigned_lane: string | null
          budget_range: string
          comparable_titles: string
          concept_lock_version: number | null
          confidence: number | null
          created_at: string
          document_urls: string[]
          format: string
          genres: string[]
          hero_image_url: string | null
          id: string
          incentive_insights: Json | null
          lifecycle_stage: string
          pinned: boolean
          pipeline_stage: string
          primary_territory: string
          reasoning: string | null
          recommendations: Json | null
          script_coverage_verdict: string
          secondary_territories: string[]
          source_pitch_idea_id: string | null
          target_audience: string
          title: string
          tone: string
          ui_mode_override: string | null
          updated_at: string
          user_id: string
          viability_breakdown: Json | null
        }
        Insert: {
          active_company_profile_id?: string | null
          analysis_passes?: Json | null
          assigned_lane?: string | null
          budget_range?: string
          comparable_titles?: string
          concept_lock_version?: number | null
          confidence?: number | null
          created_at?: string
          document_urls?: string[]
          format?: string
          genres?: string[]
          hero_image_url?: string | null
          id?: string
          incentive_insights?: Json | null
          lifecycle_stage?: string
          pinned?: boolean
          pipeline_stage?: string
          primary_territory?: string
          reasoning?: string | null
          recommendations?: Json | null
          script_coverage_verdict?: string
          secondary_territories?: string[]
          source_pitch_idea_id?: string | null
          target_audience?: string
          title: string
          tone?: string
          ui_mode_override?: string | null
          updated_at?: string
          user_id: string
          viability_breakdown?: Json | null
        }
        Update: {
          active_company_profile_id?: string | null
          analysis_passes?: Json | null
          assigned_lane?: string | null
          budget_range?: string
          comparable_titles?: string
          concept_lock_version?: number | null
          confidence?: number | null
          created_at?: string
          document_urls?: string[]
          format?: string
          genres?: string[]
          hero_image_url?: string | null
          id?: string
          incentive_insights?: Json | null
          lifecycle_stage?: string
          pinned?: boolean
          pipeline_stage?: string
          primary_territory?: string
          reasoning?: string | null
          recommendations?: Json | null
          script_coverage_verdict?: string
          secondary_territories?: string[]
          source_pitch_idea_id?: string | null
          target_audience?: string
          title?: string
          tone?: string
          ui_mode_override?: string | null
          updated_at?: string
          user_id?: string
          viability_breakdown?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_active_company_profile_id_fkey"
            columns: ["active_company_profile_id"]
            isOneToOne: false
            referencedRelation: "company_intelligence_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_pitch_idea_id_fkey"
            columns: ["source_pitch_idea_id"]
            isOneToOne: false
            referencedRelation: "pitch_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      readiness_score_history: {
        Row: {
          created_at: string
          finance_readiness_score: number
          id: string
          project_id: string
          readiness_score: number
          snapshot_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          finance_readiness_score?: number
          id?: string
          project_id: string
          readiness_score?: number
          snapshot_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          finance_readiness_score?: number
          id?: string
          project_id?: string
          readiness_score?: number
          snapshot_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "readiness_score_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rewrite_playbooks: {
        Row: {
          created_at: string
          description: string
          expected_impacts: Json
          id: string
          lane: string
          name: string
          operations: Json
          production_type: string
          triggers: Json
        }
        Insert: {
          created_at?: string
          description?: string
          expected_impacts?: Json
          id?: string
          lane?: string
          name: string
          operations?: Json
          production_type?: string
          triggers?: Json
        }
        Update: {
          created_at?: string
          description?: string
          expected_impacts?: Json
          id?: string
          lane?: string
          name?: string
          operations?: Json
          production_type?: string
          triggers?: Json
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
      script_scenes: {
        Row: {
          beat_summary: string | null
          cast_size: number | null
          conflict_type: string | null
          created_at: string
          escalation_notes: string | null
          id: string
          location: string | null
          objective: string | null
          obstacle: string | null
          pov_character: string | null
          production_weight: string | null
          scene_number: number
          scene_score: number | null
          script_id: string
          turn_summary: string | null
        }
        Insert: {
          beat_summary?: string | null
          cast_size?: number | null
          conflict_type?: string | null
          created_at?: string
          escalation_notes?: string | null
          id?: string
          location?: string | null
          objective?: string | null
          obstacle?: string | null
          pov_character?: string | null
          production_weight?: string | null
          scene_number: number
          scene_score?: number | null
          script_id: string
          turn_summary?: string | null
        }
        Update: {
          beat_summary?: string | null
          cast_size?: number | null
          conflict_type?: string | null
          created_at?: string
          escalation_notes?: string | null
          id?: string
          location?: string | null
          objective?: string | null
          obstacle?: string | null
          pov_character?: string | null
          production_weight?: string | null
          scene_number?: number
          scene_score?: number | null
          script_id?: string
          turn_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "script_scenes_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      script_versions: {
        Row: {
          batch_index: number | null
          blueprint_json: Json | null
          budget_score: number | null
          created_at: string
          dialogue_score: number | null
          draft_number: number
          economy_score: number | null
          full_text_storage_path: string | null
          id: string
          is_partial: boolean | null
          lane_alignment_score: number | null
          line_count: number | null
          notes: string | null
          page_count_est: number | null
          rewrite_pass: string | null
          runtime_min_est: number | null
          runtime_min_high: number | null
          runtime_min_low: number | null
          runtime_per_episode_est: number | null
          script_id: string
          structural_score: number | null
          word_count: number | null
        }
        Insert: {
          batch_index?: number | null
          blueprint_json?: Json | null
          budget_score?: number | null
          created_at?: string
          dialogue_score?: number | null
          draft_number: number
          economy_score?: number | null
          full_text_storage_path?: string | null
          id?: string
          is_partial?: boolean | null
          lane_alignment_score?: number | null
          line_count?: number | null
          notes?: string | null
          page_count_est?: number | null
          rewrite_pass?: string | null
          runtime_min_est?: number | null
          runtime_min_high?: number | null
          runtime_min_low?: number | null
          runtime_per_episode_est?: number | null
          script_id: string
          structural_score?: number | null
          word_count?: number | null
        }
        Update: {
          batch_index?: number | null
          blueprint_json?: Json | null
          budget_score?: number | null
          created_at?: string
          dialogue_score?: number | null
          draft_number?: number
          economy_score?: number | null
          full_text_storage_path?: string | null
          id?: string
          is_partial?: boolean | null
          lane_alignment_score?: number | null
          line_count?: number | null
          notes?: string | null
          page_count_est?: number | null
          rewrite_pass?: string | null
          runtime_min_est?: number | null
          runtime_min_high?: number | null
          runtime_min_low?: number | null
          runtime_per_episode_est?: number | null
          script_id?: string
          structural_score?: number | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "script_versions_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          budget_score: number | null
          created_at: string
          created_by: string
          dialogue_score: number | null
          draft_number: number | null
          economy_score: number | null
          file_path: string | null
          hash: string | null
          id: string
          is_current: boolean | null
          lane_alignment_score: number | null
          latest_batch_index: number | null
          latest_batch_storage_path: string | null
          latest_draft_number: number | null
          latest_page_count_est: number | null
          latest_runtime_min_est: number | null
          latest_runtime_min_high: number | null
          latest_runtime_min_low: number | null
          owner_id: string | null
          page_map: Json | null
          project_id: string
          status: string | null
          structural_score: number | null
          text_content: string | null
          version: number
          version_label: string | null
        }
        Insert: {
          budget_score?: number | null
          created_at?: string
          created_by: string
          dialogue_score?: number | null
          draft_number?: number | null
          economy_score?: number | null
          file_path?: string | null
          hash?: string | null
          id?: string
          is_current?: boolean | null
          lane_alignment_score?: number | null
          latest_batch_index?: number | null
          latest_batch_storage_path?: string | null
          latest_draft_number?: number | null
          latest_page_count_est?: number | null
          latest_runtime_min_est?: number | null
          latest_runtime_min_high?: number | null
          latest_runtime_min_low?: number | null
          owner_id?: string | null
          page_map?: Json | null
          project_id: string
          status?: string | null
          structural_score?: number | null
          text_content?: string | null
          version?: number
          version_label?: string | null
        }
        Update: {
          budget_score?: number | null
          created_at?: string
          created_by?: string
          dialogue_score?: number | null
          draft_number?: number | null
          economy_score?: number | null
          file_path?: string | null
          hash?: string | null
          id?: string
          is_current?: boolean | null
          lane_alignment_score?: number | null
          latest_batch_index?: number | null
          latest_batch_storage_path?: string | null
          latest_draft_number?: number | null
          latest_page_count_est?: number | null
          latest_runtime_min_est?: number | null
          latest_runtime_min_high?: number | null
          latest_runtime_min_low?: number | null
          owner_id?: string | null
          page_map?: Json | null
          project_id?: string
          status?: string | null
          structural_score?: number | null
          text_content?: string | null
          version?: number
          version_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_source_evaluations: {
        Row: {
          accuracy_score: number
          correlation_details: Json
          created_at: string
          evaluation_period: string
          id: string
          promoted_at: string | null
          sample_size: number
          source_id: string
        }
        Insert: {
          accuracy_score?: number
          correlation_details?: Json
          created_at?: string
          evaluation_period?: string
          id?: string
          promoted_at?: string | null
          sample_size?: number
          source_id: string
        }
        Update: {
          accuracy_score?: number
          correlation_details?: Json
          created_at?: string
          evaluation_period?: string
          id?: string
          promoted_at?: string | null
          sample_size?: number
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_source_evaluations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_signals: {
        Row: {
          created_at: string
          id: string
          note: string
          project_id: string | null
          shared_by: string
          shared_with: string
          signal_id: string
          signal_name: string
          signal_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string
          project_id?: string | null
          shared_by: string
          shared_with: string
          signal_id: string
          signal_name?: string
          signal_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          project_id?: string | null
          shared_by?: string
          shared_with?: string
          signal_id?: string
          signal_name?: string
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_signals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      stage_gates: {
        Row: {
          blockers: string[] | null
          created_at: string
          gate_name: string
          id: string
          project_id: string
          required_artifacts: string[] | null
          score: number | null
          sort_order: number | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          blockers?: string[] | null
          created_at?: string
          gate_name: string
          id?: string
          project_id: string
          required_artifacts?: string[] | null
          score?: number | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          blockers?: string[] | null
          created_at?: string
          gate_name?: string
          id?: string
          project_id?: string
          required_artifacts?: string[] | null
          score?: number | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_gates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          seats_included: number
          seats_used: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          seats_included?: number
          seats_used?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          seats_included?: number
          seats_used?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_health_checks: {
        Row: {
          check_name: string
          checks: Json
          created_at: string
          evidence: Json
          failures: string[]
          id: string
          pass: boolean
          user_id: string | null
        }
        Insert: {
          check_name: string
          checks?: Json
          created_at?: string
          evidence?: Json
          failures?: string[]
          id?: string
          pass: boolean
          user_id?: string | null
        }
        Update: {
          check_name?: string
          checks?: Json
          created_at?: string
          evidence?: Json
          failures?: string[]
          id?: string
          pass?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      territory_cost_index: {
        Row: {
          accommodation_day: number
          confidence: string
          cost_index: number
          created_at: string
          crew_day_rate_high: number
          crew_day_rate_low: number
          currency: string
          id: string
          incentive_headline: string
          infrastructure_rating: string
          labor_quality: string
          last_verified_at: string
          location_permit_avg: number
          notes: string
          per_diem: number
          region: string
          source_url: string
          stage_day_rate: number
          territory: string
          timezone: string
          updated_at: string
        }
        Insert: {
          accommodation_day?: number
          confidence?: string
          cost_index?: number
          created_at?: string
          crew_day_rate_high?: number
          crew_day_rate_low?: number
          currency?: string
          id?: string
          incentive_headline?: string
          infrastructure_rating?: string
          labor_quality?: string
          last_verified_at?: string
          location_permit_avg?: number
          notes?: string
          per_diem?: number
          region?: string
          source_url?: string
          stage_day_rate?: number
          territory: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          accommodation_day?: number
          confidence?: string
          cost_index?: number
          created_at?: string
          crew_day_rate_high?: number
          crew_day_rate_low?: number
          currency?: string
          id?: string
          incentive_headline?: string
          infrastructure_rating?: string
          labor_quality?: string
          last_verified_at?: string
          location_permit_avg?: number
          notes?: string
          per_diem?: number
          region?: string
          source_url?: string
          stage_day_rate?: number
          territory?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      trend_engines: {
        Row: {
          base_weight_default: number
          confidence: string
          created_at: string
          description: string
          enabled: boolean
          engine_name: string
          engine_type: string
          id: string
          intelligence_layer: string
          last_refresh: string | null
          refresh_frequency: string
          status: string
          updated_at: string
        }
        Insert: {
          base_weight_default?: number
          confidence?: string
          created_at?: string
          description?: string
          enabled?: boolean
          engine_name: string
          engine_type?: string
          id?: string
          intelligence_layer?: string
          last_refresh?: string | null
          refresh_frequency?: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_weight_default?: number
          confidence?: string
          created_at?: string
          description?: string
          enabled?: boolean
          engine_name?: string
          engine_type?: string
          id?: string
          intelligence_layer?: string
          last_refresh?: string | null
          refresh_frequency?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      trend_signals: {
        Row: {
          archived_at: string | null
          budget_tier: string
          category: string
          created_at: string
          cycle_phase: string
          explanation: string
          first_detected_at: string
          forecast: string
          format_tags: string[]
          genre_tags: string[]
          id: string
          lane_relevance: string[]
          last_updated_at: string
          name: string
          production_type: string
          region: string
          saturation_risk: string
          sources_count: number
          status: string
          strength: number
          target_buyer: string
          tone_tags: string[]
          velocity: string
        }
        Insert: {
          archived_at?: string | null
          budget_tier?: string
          category: string
          created_at?: string
          cycle_phase: string
          explanation: string
          first_detected_at?: string
          forecast?: string
          format_tags?: string[]
          genre_tags?: string[]
          id?: string
          lane_relevance?: string[]
          last_updated_at?: string
          name: string
          production_type?: string
          region?: string
          saturation_risk?: string
          sources_count?: number
          status?: string
          strength?: number
          target_buyer?: string
          tone_tags?: string[]
          velocity?: string
        }
        Update: {
          archived_at?: string | null
          budget_tier?: string
          category?: string
          created_at?: string
          cycle_phase?: string
          explanation?: string
          first_detected_at?: string
          forecast?: string
          format_tags?: string[]
          genre_tags?: string[]
          id?: string
          lane_relevance?: string[]
          last_updated_at?: string
          name?: string
          production_type?: string
          region?: string
          saturation_risk?: string
          sources_count?: number
          status?: string
          strength?: number
          target_buyer?: string
          tone_tags?: string[]
          velocity?: string
        }
        Relationships: []
      }
      trend_weekly_briefs: {
        Row: {
          created_at: string
          id: string
          production_type: string
          summary: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          production_type?: string
          summary: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          production_type?: string
          summary?: string
          week_start?: string
        }
        Relationships: []
      }
      usage_tracking: {
        Row: {
          ai_analyses_used: number
          buyer_contacts_count: number
          cast_research_used: number
          created_at: string
          id: string
          period_start: string
          projects_count: number
          storage_bytes_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_analyses_used?: number
          buyer_contacts_count?: number
          cast_research_used?: number
          created_at?: string
          id?: string
          period_start?: string
          projects_count?: number
          storage_bytes_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_analyses_used?: number
          buyer_contacts_count?: number
          cast_research_used?: number
          created_at?: string
          id?: string
          period_start?: string
          projects_count?: number
          storage_bytes_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          owner_id: string
          prefs: Json
          updated_at: string
        }
        Insert: {
          owner_id: string
          prefs?: Json
          updated_at?: string
        }
        Update: {
          owner_id?: string
          prefs?: Json
          updated_at?: string
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["app_role"]
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
      vertical_data_sources: {
        Row: {
          category: string
          created_at: string
          id: string
          notes: string
          refresh_frequency: string
          region: string
          reliability_score: number
          source_name: string
          source_type: string
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          notes?: string
          refresh_frequency?: string
          region?: string
          reliability_score?: number
          source_name: string
          source_type?: string
          status?: string
          updated_at?: string
          url?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          notes?: string
          refresh_frequency?: string
          region?: string
          reliability_score?: number
          source_name?: string
          source_type?: string
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      vertical_trend_snapshots: {
        Row: {
          created_at: string
          episode_patterns: Json
          id: string
          raw_data: Json
          region: string
          revenue_shifts: Json
          snapshot_date: string
          top_apps: Json
          top_micro_genres: Json
        }
        Insert: {
          created_at?: string
          episode_patterns?: Json
          id?: string
          raw_data?: Json
          region?: string
          revenue_shifts?: Json
          snapshot_date?: string
          top_apps?: Json
          top_micro_genres?: Json
        }
        Update: {
          created_at?: string
          episode_patterns?: Json
          id?: string
          raw_data?: Json
          region?: string
          revenue_shifts?: Json
          snapshot_date?: string
          top_apps?: Json
          top_micro_genres?: Json
        }
        Relationships: []
      }
      vfx_shots: {
        Row: {
          complexity: string
          created_at: string
          due_date: string | null
          id: string
          notes: string
          project_id: string
          shot_id: string
          status: string
          updated_at: string
          user_id: string
          vendor: string
        }
        Insert: {
          complexity?: string
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string
          project_id: string
          shot_id?: string
          status?: string
          updated_at?: string
          user_id: string
          vendor?: string
        }
        Update: {
          complexity?: string
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string
          project_id?: string
          shot_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "vfx_shots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      outcome_accuracy_summary: {
        Row: {
          avg_commercial_delta: number | null
          avg_gap_score: number | null
          budget_accuracy: number | null
          finance_accuracy: number | null
          greenlight_accuracy: number | null
          lane_accuracy: number | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite_link: { Args: { _token: string }; Returns: Json }
      check_document_access: {
        Args: { _file_path: string; _user_id: string }
        Returns: boolean
      }
      compute_outcome_deltas: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      get_deal_finance_summary: { Args: { _project_id: string }; Returns: Json }
      get_project_role: {
        Args: { _project_id: string; _user_id: string }
        Returns: string
      }
      has_project_access: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      search_corpus_chunks: {
        Args: { match_count?: number; p_user_id?: string; search_query: string }
        Returns: {
          chunk_index: number
          chunk_text: string
          id: string
          rank: number
          script_id: string
        }[]
      }
      search_corpus_semantic: {
        Args: {
          filter_script_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_text: string
          distance: number
          script_id: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
      project_role: ["producer", "sales_agent", "lawyer", "creative"],
    },
  },
} as const
