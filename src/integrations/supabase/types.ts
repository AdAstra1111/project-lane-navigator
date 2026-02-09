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
          status: string
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
          status?: string
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
          status?: string
          trend_type?: string
        }
        Relationships: []
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
      [_ in never]: never
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
