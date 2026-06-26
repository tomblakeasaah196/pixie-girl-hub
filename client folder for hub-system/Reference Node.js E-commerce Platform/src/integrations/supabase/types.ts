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
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          line1: string
          line2: string | null
          phone: string | null
          postal_code: string | null
          recipient: string
          region: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          line1: string
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
          recipient: string
          region?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          line1?: string
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
          recipient?: string
          region?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          address: Json | null
          cancellation_reason: string | null
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string | null
          deposit_amount_ngn: number | null
          deposit_paid: boolean
          duration_minutes: number
          id: string
          location_type: Database["public"]["Enums"]["service_location"]
          notes: string | null
          payment_provider: string | null
          scheduled_at: string
          service_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: Json | null
          cancellation_reason?: string | null
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          deposit_amount_ngn?: number | null
          deposit_paid?: boolean
          duration_minutes: number
          id?: string
          location_type: Database["public"]["Enums"]["service_location"]
          notes?: string | null
          payment_provider?: string | null
          scheduled_at: string
          service_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: Json | null
          cancellation_reason?: string | null
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          deposit_amount_ngn?: number | null
          deposit_paid?: boolean
          duration_minutes?: number
          id?: string
          location_type?: Database["public"]["Enums"]["service_location"]
          notes?: string | null
          payment_provider?: string | null
          scheduled_at?: string
          service_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_requests: {
        Row: {
          budget: string | null
          created_at: string
          id: string
          message: string
          preferred_length: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          budget?: string | null
          created_at?: string
          id?: string
          message: string
          preferred_length?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          budget?: string | null
          created_at?: string
          id?: string
          message?: string
          preferred_length?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          concierge_notes: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          id: string
          items: Json
          notes: string | null
          order_number: string
          preferred_contact: string | null
          shipping_address: Json | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          concierge_notes?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          items?: Json
          notes?: string | null
          order_number?: string
          preferred_contact?: string | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          concierge_notes?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          items?: Json
          notes?: string | null
          order_number?: string
          preferred_contact?: string | null
          shipping_address?: Json | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          email_concierge: boolean
          email_loyalty: boolean
          email_marketing: boolean
          email_order_updates: boolean
          full_name: string | null
          id: string
          marketing_opt_in: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_concierge?: boolean
          email_loyalty?: boolean
          email_marketing?: boolean
          email_order_updates?: boolean
          full_name?: string | null
          id: string
          marketing_opt_in?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_concierge?: boolean
          email_loyalty?: boolean
          email_marketing?: boolean
          email_order_updates?: boolean
          full_name?: string | null
          id?: string
          marketing_opt_in?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          buffer_minutes: number
          cancellation_policy: string | null
          compare_at_price_ngn: number | null
          created_at: string
          deposit_amount_ngn: number | null
          deposit_pct: number | null
          deposit_required: boolean
          duration_minutes: number | null
          gallery_urls: string[]
          id: string
          is_bookable: boolean
          is_featured: boolean
          is_visible_storefront: boolean
          location_type: Database["public"]["Enums"]["service_location"]
          long_description: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          price_is_from: boolean
          price_ngn: number | null
          published_at: string | null
          required_stylist_tier: string | null
          short_description: string | null
          slug: string
          tags: string[]
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number
          cancellation_policy?: string | null
          compare_at_price_ngn?: number | null
          created_at?: string
          deposit_amount_ngn?: number | null
          deposit_pct?: number | null
          deposit_required?: boolean
          duration_minutes?: number | null
          gallery_urls?: string[]
          id?: string
          is_bookable?: boolean
          is_featured?: boolean
          is_visible_storefront?: boolean
          location_type?: Database["public"]["Enums"]["service_location"]
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          price_is_from?: boolean
          price_ngn?: number | null
          published_at?: string | null
          required_stylist_tier?: string | null
          short_description?: string | null
          slug: string
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          cancellation_policy?: string | null
          compare_at_price_ngn?: number | null
          created_at?: string
          deposit_amount_ngn?: number | null
          deposit_pct?: number | null
          deposit_required?: boolean
          duration_minutes?: number | null
          gallery_urls?: string[]
          id?: string
          is_bookable?: boolean
          is_featured?: boolean
          is_visible_storefront?: boolean
          location_type?: Database["public"]["Enums"]["service_location"]
          long_description?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          price_is_from?: boolean
          price_ngn?: number | null
          published_at?: string | null
          required_stylist_tier?: string | null
          short_description?: string | null
          slug?: string
          tags?: string[]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_content_overrides: {
        Row: {
          created_at: string
          key: string
          scope: string
          scope_id: string | null
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          scope?: string
          scope_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          scope?: string
          scope_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
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
      wishlist_items: {
        Row: {
          created_at: string
          id: string
          product_slug: string
          user_id: string
          variant: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_slug: string
          user_id: string
          variant?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_slug?: string
          user_id?: string
          variant?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      request_order_cancellation: {
        Args: { _order_id: string; _reason: string }
        Returns: {
          concierge_notes: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          id: string
          items: Json
          notes: string | null
          order_number: string
          preferred_contact: string | null
          shipping_address: Json | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      service_location: "studio" | "home" | "virtual"
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
      service_location: ["studio", "home", "virtual"],
    },
  },
} as const
