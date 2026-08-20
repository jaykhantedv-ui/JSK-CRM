export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          address: string | null
          alt_phone: string | null
          archived_at: string | null
          archived_by: string | null
          area: string | null
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_normalized: string | null
          gstin: string | null
          id: string
          import_batch_id: string | null
          is_imported: boolean
          last_activity_at: string | null
          legacy_ref: string | null
          name: string
          notes: string | null
          outlet_id: string
          owner_id: string
          phone: string | null
          phone_normalized: string | null
          referred_by_contact_id: string | null
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          address?: string | null
          alt_phone?: string | null
          archived_at?: string | null
          archived_by?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          gstin?: string | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          last_activity_at?: string | null
          legacy_ref?: string | null
          name: string
          notes?: string | null
          outlet_id: string
          owner_id: string
          phone?: string | null
          phone_normalized?: string | null
          referred_by_contact_id?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          address?: string | null
          alt_phone?: string | null
          archived_at?: string | null
          archived_by?: string | null
          area?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          gstin?: string | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          last_activity_at?: string | null
          legacy_ref?: string | null
          name?: string
          notes?: string | null
          outlet_id?: string
          owner_id?: string
          phone?: string | null
          phone_normalized?: string | null
          referred_by_contact_id?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_referred_by_contact_id_fkey"
            columns: ["referred_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          account_id: string
          attachment_paths: string[]
          contact_id: string | null
          created_at: string
          created_by: string | null
          duration_minutes: number | null
          id: string
          location_note: string | null
          measurements: string | null
          occurred_at: string
          opportunity_id: string | null
          outcome: Database["public"]["Enums"]["activity_outcome"]
          performed_by: string
          project_id: string | null
          purpose: Database["public"]["Enums"]["activity_purpose"]
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
          updated_at: string
        }
        Insert: {
          account_id: string
          attachment_paths?: string[]
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          id?: string
          location_note?: string | null
          measurements?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          outcome?: Database["public"]["Enums"]["activity_outcome"]
          performed_by: string
          project_id?: string | null
          purpose?: Database["public"]["Enums"]["activity_purpose"]
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          attachment_paths?: string[]
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          id?: string
          location_note?: string | null
          measurements?: string | null
          occurred_at?: string
          opportunity_id?: string | null
          outcome?: Database["public"]["Enums"]["activity_outcome"]
          performed_by?: string
          project_id?: string | null
          purpose?: Database["public"]["Enums"]["activity_purpose"]
          summary?: string
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "v_opportunity_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string | null
          alt_phone: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          influence: Database["public"]["Enums"]["influence_level"]
          is_referral_source: boolean
          linked_account_id: string | null
          notes: string | null
          owner_id: string
          phone: string | null
          phone_normalized: string | null
          preferred_channel: Database["public"]["Enums"]["contact_channel"]
          role: Database["public"]["Enums"]["stakeholder_role"]
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          alt_phone?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          influence?: Database["public"]["Enums"]["influence_level"]
          is_referral_source?: boolean
          linked_account_id?: string | null
          notes?: string | null
          owner_id: string
          phone?: string | null
          phone_normalized?: string | null
          preferred_channel?: Database["public"]["Enums"]["contact_channel"]
          role?: Database["public"]["Enums"]["stakeholder_role"]
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          alt_phone?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          influence?: Database["public"]["Enums"]["influence_level"]
          is_referral_source?: boolean
          linked_account_id?: string | null
          notes?: string | null
          owner_id?: string
          phone?: string | null
          phone_normalized?: string | null
          preferred_channel?: Database["public"]["Enums"]["contact_channel"]
          role?: Database["public"]["Enums"]["stakeholder_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_linked_account_id_fkey"
            columns: ["linked_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          entity: string
          error_rows: number
          file_name: string
          id: string
          imported_rows: number
          status: Database["public"]["Enums"]["import_status"]
          total_rows: number
          updated_at: string
          uploaded_by: string
          valid_rows: number
          warning_rows: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          entity: string
          error_rows?: number
          file_name: string
          id?: string
          imported_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          updated_at?: string
          uploaded_by: string
          valid_rows?: number
          warning_rows?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          entity?: string
          error_rows?: number
          file_name?: string
          id?: string
          imported_rows?: number
          status?: Database["public"]["Enums"]["import_status"]
          total_rows?: number
          updated_at?: string
          uploaded_by?: string
          valid_rows?: number
          warning_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          created_at: string
          created_entity_id: string | null
          decision: string | null
          duplicate_of: string | null
          id: string
          messages: Json
          normalized: Json | null
          raw: Json
          row_number: number
          status: Database["public"]["Enums"]["import_row_status"]
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_entity_id?: string | null
          decision?: string | null
          duplicate_of?: string | null
          id?: string
          messages?: Json
          normalized?: Json | null
          raw: Json
          row_number: number
          status?: Database["public"]["Enums"]["import_row_status"]
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_entity_id?: string | null
          decision?: string | null
          duplicate_of?: string | null
          id?: string
          messages?: Json
          normalized?: Json | null
          raw?: Json
          row_number?: number
          status?: Database["public"]["Enums"]["import_row_status"]
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["product_category"]
          closed_at: string | null
          competitor: string | null
          created_at: string
          created_by: string | null
          estimated_quantity: number | null
          estimated_value: number
          expected_close_date: string | null
          final_order_value: number | null
          id: string
          import_batch_id: string | null
          is_imported: boolean
          last_activity_at: string | null
          legacy_ref: string | null
          lost_detail: string | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          material_notes: string | null
          next_action: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date: string | null
          next_action_note: string | null
          order_reference: string | null
          outlet_id: string
          owner_id: string | null
          project_id: string | null
          quantity_unit: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date: string | null
          quotation_ref: string | null
          quotation_status: Database["public"]["Enums"]["quotation_status"]
          quotation_valid_until: string | null
          quoted_value: number | null
          sla_notified_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["opportunity_stage"]
          stage_changed_at: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          archived_by?: string | null
          category: Database["public"]["Enums"]["product_category"]
          closed_at?: string | null
          competitor?: string | null
          created_at?: string
          created_by?: string | null
          estimated_quantity?: number | null
          estimated_value: number
          expected_close_date?: string | null
          final_order_value?: number | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          last_activity_at?: string | null
          legacy_ref?: string | null
          lost_detail?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          material_notes?: string | null
          next_action?: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date?: string | null
          next_action_note?: string | null
          order_reference?: string | null
          outlet_id: string
          owner_id?: string | null
          project_id?: string | null
          quantity_unit?: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date?: string | null
          quotation_ref?: string | null
          quotation_status?: Database["public"]["Enums"]["quotation_status"]
          quotation_valid_until?: string | null
          quoted_value?: number | null
          sla_notified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          stage_changed_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["product_category"]
          closed_at?: string | null
          competitor?: string | null
          created_at?: string
          created_by?: string | null
          estimated_quantity?: number | null
          estimated_value?: number
          expected_close_date?: string | null
          final_order_value?: number | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          last_activity_at?: string | null
          legacy_ref?: string | null
          lost_detail?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          material_notes?: string | null
          next_action?: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date?: string | null
          next_action_note?: string | null
          order_reference?: string | null
          outlet_id?: string
          owner_id?: string | null
          project_id?: string | null
          quantity_unit?: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date?: string | null
          quotation_ref?: string | null
          quotation_status?: Database["public"]["Enums"]["quotation_status"]
          quotation_valid_until?: string | null
          quoted_value?: number | null
          sla_notified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          stage_changed_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_events: {
        Row: {
          actor_id: string
          created_at: string
          event_type: Database["public"]["Enums"]["opportunity_event_type"]
          from_owner_id: string | null
          from_stage: Database["public"]["Enums"]["opportunity_stage"] | null
          id: string
          metadata: Json
          opportunity_id: string
          reason: string | null
          to_owner_id: string | null
          to_stage: Database["public"]["Enums"]["opportunity_stage"] | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_type: Database["public"]["Enums"]["opportunity_event_type"]
          from_owner_id?: string | null
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          metadata?: Json
          opportunity_id: string
          reason?: string | null
          to_owner_id?: string | null
          to_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["opportunity_event_type"]
          from_owner_id?: string | null
          from_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          id?: string
          metadata?: Json
          opportunity_id?: string
          reason?: string | null
          to_owner_id?: string | null
          to_stage?: Database["public"]["Enums"]["opportunity_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_events_from_owner_id_fkey"
            columns: ["from_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "v_opportunity_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_events_to_owner_id_fkey"
            columns: ["to_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          city: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stakeholders: {
        Row: {
          account_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          id: string
          influence: Database["public"]["Enums"]["influence_level"]
          is_primary: boolean
          notes: string | null
          project_id: string
          role: Database["public"]["Enums"]["stakeholder_role"]
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          influence?: Database["public"]["Enums"]["influence_level"]
          is_primary?: boolean
          notes?: string | null
          project_id: string
          role: Database["public"]["Enums"]["stakeholder_role"]
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          influence?: Database["public"]["Enums"]["influence_level"]
          is_primary?: boolean
          notes?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["stakeholder_role"]
        }
        Relationships: [
          {
            foreignKeyName: "project_stakeholders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stakeholders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          area: string | null
          bathrooms: number | null
          builtup_area_sqft: number | null
          city: string | null
          construction_stage: Database["public"]["Enums"]["construction_stage"]
          created_at: string
          created_by: string | null
          estimated_value: number | null
          expected_flooring_date: string | null
          floors: number | null
          id: string
          import_batch_id: string | null
          is_imported: boolean
          legacy_ref: string | null
          name: string
          notes: string | null
          outlet_id: string
          owner_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          site_address: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          archived_by?: string | null
          area?: string | null
          bathrooms?: number | null
          builtup_area_sqft?: number | null
          city?: string | null
          construction_stage?: Database["public"]["Enums"]["construction_stage"]
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_flooring_date?: string | null
          floors?: number | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          legacy_ref?: string | null
          name: string
          notes?: string | null
          outlet_id: string
          owner_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          site_address?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          archived_by?: string | null
          area?: string | null
          bathrooms?: number | null
          builtup_area_sqft?: number | null
          city?: string | null
          construction_stage?: Database["public"]["Enums"]["construction_stage"]
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_flooring_date?: string | null
          floors?: number | null
          id?: string
          import_batch_id?: string | null
          is_imported?: boolean
          legacy_ref?: string | null
          name?: string
          notes?: string | null
          outlet_id?: string
          owner_id?: string
          project_type?: Database["public"]["Enums"]["project_type"]
          site_address?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          outlet_id: string | null
          period_month: string
          target_paise: number
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          outlet_id?: string | null
          period_month: string
          target_paise: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          outlet_id?: string | null
          period_month?: string
          target_paise?: number
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_targets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_outlets: {
        Row: {
          assigned_at: string
          created_at: string
          created_by: string | null
          id: string
          outlet_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          outlet_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          outlet_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_outlets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_outlets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_outlets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_opportunity_flags: {
        Row: {
          account_id: string | null
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["product_category"] | null
          closed_at: string | null
          competitor: string | null
          created_at: string | null
          created_by: string | null
          days_in_stage: number | null
          days_since_activity: number | null
          estimated_quantity: number | null
          estimated_value: number | null
          expected_close_date: string | null
          final_order_value: number | null
          id: string | null
          import_batch_id: string | null
          in_pipeline: boolean | null
          is_active: boolean | null
          is_due_today: boolean | null
          is_imported: boolean | null
          is_missing_next_action: boolean | null
          is_overdue: boolean | null
          is_unassigned: boolean | null
          last_activity_at: string | null
          legacy_ref: string | null
          lost_detail: string | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          material_notes: string | null
          next_action: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date: string | null
          next_action_note: string | null
          order_reference: string | null
          outlet_id: string | null
          owner_id: string | null
          project_id: string | null
          quantity_unit: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date: string | null
          quotation_ref: string | null
          quotation_status:
            Database["public"]["Enums"]["quotation_status"] | null
          quotation_valid_until: string | null
          quoted_value: number | null
          sla_notified_at: string | null
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["opportunity_stage"] | null
          stage_changed_at: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["product_category"] | null
          closed_at?: string | null
          competitor?: string | null
          created_at?: string | null
          created_by?: string | null
          days_in_stage?: never
          days_since_activity?: never
          estimated_quantity?: number | null
          estimated_value?: number | null
          expected_close_date?: string | null
          final_order_value?: number | null
          id?: string | null
          import_batch_id?: string | null
          in_pipeline?: never
          is_active?: never
          is_due_today?: never
          is_imported?: boolean | null
          is_missing_next_action?: never
          is_overdue?: never
          is_unassigned?: never
          last_activity_at?: string | null
          legacy_ref?: string | null
          lost_detail?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          material_notes?: string | null
          next_action?: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date?: string | null
          next_action_note?: string | null
          order_reference?: string | null
          outlet_id?: string | null
          owner_id?: string | null
          project_id?: string | null
          quantity_unit?: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date?: string | null
          quotation_ref?: string | null
          quotation_status?:
            Database["public"]["Enums"]["quotation_status"] | null
          quotation_valid_until?: string | null
          quoted_value?: number | null
          sla_notified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          stage_changed_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["product_category"] | null
          closed_at?: string | null
          competitor?: string | null
          created_at?: string | null
          created_by?: string | null
          days_in_stage?: never
          days_since_activity?: never
          estimated_quantity?: number | null
          estimated_value?: number | null
          expected_close_date?: string | null
          final_order_value?: number | null
          id?: string | null
          import_batch_id?: string | null
          in_pipeline?: never
          is_active?: never
          is_due_today?: never
          is_imported?: boolean | null
          is_missing_next_action?: never
          is_overdue?: never
          is_unassigned?: never
          last_activity_at?: string | null
          legacy_ref?: string | null
          lost_detail?: string | null
          lost_reason?: Database["public"]["Enums"]["lost_reason"] | null
          material_notes?: string | null
          next_action?: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date?: string | null
          next_action_note?: string | null
          order_reference?: string | null
          outlet_id?: string | null
          owner_id?: string | null
          project_id?: string | null
          quantity_unit?: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date?: string | null
          quotation_ref?: string | null
          quotation_status?:
            Database["public"]["Enums"]["quotation_status"] | null
          quotation_valid_until?: string | null
          quoted_value?: number | null
          sla_notified_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          stage_changed_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assert_management_access: { Args: never; Returns: undefined }
      bulk_reassign: {
        Args: { p_from_user: string; p_reason: string; p_to_user: string }
        Returns: number
      }
      can_read_account: { Args: { a: string }; Returns: boolean }
      can_read_opportunity: { Args: { o: string }; Returns: boolean }
      can_read_project: { Args: { p: string }; Returns: boolean }
      can_write_project: { Args: { p: string }; Returns: boolean }
      change_opportunity_stage: {
        Args: {
          p_competitor?: string
          p_final_order_value?: number
          p_lost_detail?: string
          p_lost_reason?: Database["public"]["Enums"]["lost_reason"]
          p_next_action?: Database["public"]["Enums"]["next_action_type"]
          p_next_action_date?: string
          p_next_action_note?: string
          p_opportunity_id: string
          p_order_reference?: string
          p_quotation_date?: string
          p_quotation_ref?: string
          p_quoted_value?: number
          p_reason?: string
          p_to_stage: Database["public"]["Enums"]["opportunity_stage"]
        }
        Returns: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["product_category"]
          closed_at: string | null
          competitor: string | null
          created_at: string
          created_by: string | null
          estimated_quantity: number | null
          estimated_value: number
          expected_close_date: string | null
          final_order_value: number | null
          id: string
          import_batch_id: string | null
          is_imported: boolean
          last_activity_at: string | null
          legacy_ref: string | null
          lost_detail: string | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          material_notes: string | null
          next_action: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date: string | null
          next_action_note: string | null
          order_reference: string | null
          outlet_id: string
          owner_id: string | null
          project_id: string | null
          quantity_unit: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date: string | null
          quotation_ref: string | null
          quotation_status: Database["public"]["Enums"]["quotation_status"]
          quotation_valid_until: string | null
          quoted_value: number | null
          sla_notified_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["opportunity_stage"]
          stage_changed_at: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_account_with_opportunity: {
        Args: {
          p_account_type: Database["public"]["Enums"]["account_type"]
          p_address?: string
          p_area?: string
          p_category: Database["public"]["Enums"]["product_category"]
          p_city?: string
          p_email?: string
          p_estimated_value: number
          p_expected_close_date?: string
          p_material_notes?: string
          p_name: string
          p_next_action?: Database["public"]["Enums"]["next_action_type"]
          p_next_action_date?: string
          p_next_action_note?: string
          p_notes?: string
          p_outlet_id: string
          p_phone?: string
          p_project_id?: string
          p_source?: Database["public"]["Enums"]["lead_source"]
          p_title: string
        }
        Returns: {
          account_id: string
          activity_id: string
          opportunity_id: string
        }[]
      }
      current_user_id: { Args: never; Returns: string }
      find_account_duplicates: {
        Args: {
          p_city?: string
          p_email?: string
          p_exclude_id?: string
          p_limit?: number
          p_name?: string
          p_name_city_threshold: number
          p_name_only_threshold: number
          p_phone?: string
        }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          city: string
          email: string
          id: string
          name: string
          name_similarity: number
          owner_id: string
          phone: string
          signal: string
          status: Database["public"]["Enums"]["account_status"]
        }[]
      }
      is_manager_or_above: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_owner_or_admin: { Args: never; Returns: boolean }
      like_escape: { Args: { raw: string }; Returns: string }
      log_activity: {
        Args: {
          p_account_id: string
          p_clear_next_action?: boolean
          p_contact_id?: string
          p_duration_minutes?: number
          p_location_note?: string
          p_measurements?: string
          p_next_action?: Database["public"]["Enums"]["next_action_type"]
          p_next_action_date?: string
          p_next_action_note?: string
          p_occurred_at?: string
          p_opportunity_id?: string
          p_outcome?: Database["public"]["Enums"]["activity_outcome"]
          p_project_id?: string
          p_purpose?: Database["public"]["Enums"]["activity_purpose"]
          p_summary: string
          p_type: Database["public"]["Enums"]["activity_type"]
        }
        Returns: {
          activity_id: string
          opportunity_id: string
        }[]
      }
      management_at_risk: {
        Args: {
          p_dormancy_days: number
          p_limit?: number
          p_offset?: number
          p_outlet?: string
          p_owner?: string
          p_stall_days: Json
        }
        Returns: {
          account_id: string
          account_name: string
          days_in_stage: number
          days_since_activity: number
          estimated_value: number
          id: string
          is_missing_next_action: boolean
          is_overdue: boolean
          last_activity_at: string
          next_action: Database["public"]["Enums"]["next_action_type"]
          next_action_date: string
          outlet_id: string
          outlet_name: string
          owner_id: string
          owner_name: string
          project_id: string
          project_name: string
          stage: Database["public"]["Enums"]["opportunity_stage"]
          stage_stall_days: number
          title: string
          total_count: number
        }[]
      }
      management_customer_sales: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          account_id: string
          account_name: string
          account_type: Database["public"]["Enums"]["account_type"]
          last_activity_at: string
          lost_count: number
          open_count: number
          outlet_id: string
          pipeline_value_paise: number
          total_count: number
          won_count: number
          won_value_paise: number
        }[]
      }
      management_exceptions: {
        Args: {
          p_dormancy_days: number
          p_high_value: number
          p_outlet?: string
          p_owner?: string
          p_sla_cutoff: string
          p_stall_days: Json
        }
        Returns: {
          active_total: number
          dormant: number
          high_value_at_risk: number
          missing_next_action: number
          overdue: number
          overdue_value_paise: number
          quotation_expired: number
          sla_breach: number
          stalled: number
          unassigned: number
        }[]
      }
      management_lost_reasons: {
        Args: {
          p_from: string
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          lost_count: number
          lost_reason: Database["public"]["Enums"]["lost_reason"]
          lost_value_paise: number
        }[]
      }
      management_outlet_comparison: {
        Args: { p_from: string; p_to: string }
        Returns: {
          active_count: number
          lost_count: number
          new_enquiry_count: number
          outlet_code: string
          outlet_id: string
          outlet_name: string
          overdue_count: number
          pipeline_value_paise: number
          quoted_reached_count: number
          quoted_value_paise: number
          quoted_won_count: number
          site_visit_count: number
          won_count: number
          won_value_paise: number
        }[]
      }
      management_period_summary: {
        Args: {
          p_from: string
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          lost_count: number
          lost_value_paise: number
          new_enquiry_count: number
          quoted_value_paise: number
          won_count: number
          won_value_paise: number
        }[]
      }
      management_pipeline_by_stage: {
        Args: { p_outlet?: string; p_owner?: string; p_probabilities: Json }
        Returns: {
          counts_in_pipeline: boolean
          opportunity_count: number
          stage: Database["public"]["Enums"]["opportunity_stage"]
          value_paise: number
          weighted_paise: number
        }[]
      }
      management_project_sales: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          account_id: string
          account_name: string
          lost_count: number
          open_count: number
          opportunity_count: number
          outlet_id: string
          pipeline_value_paise: number
          project_id: string
          project_name: string
          project_status: Database["public"]["Enums"]["project_status"]
          project_type: Database["public"]["Enums"]["project_type"]
          total_count: number
          won_count: number
          won_value_paise: number
        }[]
      }
      management_quotation_turnaround: {
        Args: {
          p_from: string
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          average_days: number
          excluded_count: number
          measured_count: number
          median_days: number
          slowest_days: number
          within_two_days: number
        }[]
      }
      management_quote_conversion: {
        Args: {
          p_from: string
          p_outlet?: string
          p_owner?: string
          p_to: string
        }
        Returns: {
          lost_after_quote_count: number
          never_quoted_won_count: number
          reached_quoted_count: number
          won_after_quote_count: number
          won_after_quote_value_paise: number
        }[]
      }
      management_site_visits: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_outlet?: string
          p_owner?: string
          p_project?: string
          p_to: string
        }
        Returns: {
          account_id: string
          account_name: string
          id: string
          location_note: string
          measurements: string
          occurred_at: string
          opportunity_id: string
          outcome: Database["public"]["Enums"]["activity_outcome"]
          outlet_id: string
          outlet_name: string
          performed_by: string
          performed_by_name: string
          project_id: string
          project_name: string
          purpose: Database["public"]["Enums"]["activity_purpose"]
          summary: string
          total_count: number
        }[]
      }
      management_team_workload: {
        Args: {
          p_from: string
          p_outlet?: string
          p_stall_days: Json
          p_to: string
        }
        Returns: {
          active_count: number
          activity_count: number
          due_today_count: number
          full_name: string
          is_active: boolean
          last_activity_at: string
          lost_count: number
          missing_next_action: number
          overdue_count: number
          pipeline_value_paise: number
          quoted_reached_count: number
          quoted_won_count: number
          role: Database["public"]["Enums"]["user_role"]
          site_visit_count: number
          stalled_count: number
          user_id: string
          won_count: number
          won_value_paise: number
        }[]
      }
      management_won_by_month: {
        Args: { p_months: number; p_outlet?: string }
        Returns: {
          month_start: string
          won_count: number
          won_value_paise: number
        }[]
      }
      manages_outlet: { Args: { p_outlet: string }; Returns: boolean }
      manages_user: { Args: { p_user: string }; Returns: boolean }
      normalize_phone: { Args: { raw: string }; Returns: string }
      owns_opportunity_on_account: { Args: { a: string }; Returns: boolean }
      owns_opportunity_on_project: { Args: { p: string }; Returns: boolean }
      raise_not_found: { Args: never; Returns: undefined }
      reassign_opportunity: {
        Args: { p_opportunity_id: string; p_reason: string; p_to_user: string }
        Returns: {
          account_id: string
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["product_category"]
          closed_at: string | null
          competitor: string | null
          created_at: string
          created_by: string | null
          estimated_quantity: number | null
          estimated_value: number
          expected_close_date: string | null
          final_order_value: number | null
          id: string
          import_batch_id: string | null
          is_imported: boolean
          last_activity_at: string | null
          legacy_ref: string | null
          lost_detail: string | null
          lost_reason: Database["public"]["Enums"]["lost_reason"] | null
          material_notes: string | null
          next_action: Database["public"]["Enums"]["next_action_type"] | null
          next_action_date: string | null
          next_action_note: string | null
          order_reference: string | null
          outlet_id: string
          owner_id: string | null
          project_id: string | null
          quantity_unit: Database["public"]["Enums"]["quantity_unit"] | null
          quotation_date: string | null
          quotation_ref: string | null
          quotation_status: Database["public"]["Enums"]["quotation_status"]
          quotation_valid_until: string | null
          quoted_value: number | null
          sla_notified_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["opportunity_stage"]
          stage_changed_at: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      scoped_outlet_ids: { Args: never; Returns: string[] }
      search_crm: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          entity: string
          id: string
          rank: number
          score: number
          subtitle: string
          title: string
        }[]
      }
      system_user_id: { Args: never; Returns: string }
      user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
    }
    Enums: {
      account_status: "PROSPECT" | "ACTIVE" | "DORMANT" | "DO_NOT_CONTACT"
      account_type:
        | "HOMEOWNER"
        | "CONTRACTOR"
        | "BUILDER"
        | "ARCHITECT"
        | "INTERIOR_DESIGNER"
        | "DEALER"
        | "COMMERCIAL"
        | "MASON"
        | "OTHER"
      activity_outcome:
        "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NO_RESPONSE" | "RESCHEDULED"
      activity_purpose:
        | "ENQUIRY"
        | "FOLLOW_UP"
        | "PRODUCT_DISCUSSION"
        | "SITE_MEASUREMENT"
        | "SAMPLE_HANDOVER"
        | "QUOTATION_DISCUSSION"
        | "PRICE_NEGOTIATION"
        | "ORDER_CONFIRMATION"
        | "RELATIONSHIP"
        | "OTHER"
      activity_type:
        | "CALL"
        | "WHATSAPP"
        | "SHOWROOM_VISIT"
        | "SITE_VISIT"
        | "MEETING"
        | "EMAIL"
        | "NOTE"
      construction_stage:
        | "PLANNING"
        | "FOUNDATION"
        | "STRUCTURE"
        | "BRICKWORK"
        | "PLASTERING"
        | "FLOORING_STAGE"
        | "FINISHING"
        | "COMPLETED"
        | "RENOVATION"
        | "UNKNOWN"
      contact_channel: "CALL" | "WHATSAPP" | "IN_PERSON" | "EMAIL"
      import_row_status:
        | "VALID"
        | "WARNING"
        | "ERROR"
        | "DUPLICATE_EXACT"
        | "DUPLICATE_POSSIBLE"
        | "IMPORTED"
        | "SKIPPED"
      import_status:
        | "UPLOADED"
        | "VALIDATING"
        | "REVIEW"
        | "IMPORTING"
        | "COMPLETED"
        | "FAILED"
        | "ROLLED_BACK"
      influence_level:
        | "DECISION_MAKER"
        | "STRONG_INFLUENCER"
        | "INFLUENCER"
        | "EXECUTOR"
        | "INFORMATION_ONLY"
      lead_source:
        | "WALK_IN"
        | "PHONE_ENQUIRY"
        | "CUSTOMER_REFERRAL"
        | "ARCHITECT_REFERRAL"
        | "CONTRACTOR_REFERRAL"
        | "SIGNAGE"
        | "SOCIAL_MEDIA"
        | "EXHIBITION"
        | "EXISTING_CUSTOMER"
        | "OTHER"
      lost_reason:
        | "PRICE"
        | "STOCK_UNAVAILABLE"
        | "DELIVERY_TIME"
        | "DESIGN_NOT_AVAILABLE"
        | "COMPETITOR_RELATIONSHIP"
        | "PROJECT_POSTPONED"
        | "PROJECT_CANCELLED"
        | "BUDGET_CUT"
        | "SPECIFIED_OTHER_BRAND"
        | "CREDIT_TERMS"
        | "SERVICE_RESPONSE"
        | "NOT_GENUINE"
        | "NO_RESPONSE"
        | "UNKNOWN"
      next_action_type:
        | "CALL"
        | "SHOWROOM_VISIT"
        | "SITE_VISIT"
        | "SEND_QUOTATION"
        | "SHARE_SAMPLES"
        | "QUOTATION_FOLLOWUP"
        | "PRICE_DISCUSSION"
        | "AWAIT_CUSTOMER"
        | "OTHER"
      opportunity_event_type:
        | "CREATED"
        | "STAGE_CHANGED"
        | "OWNER_CHANGED"
        | "WON"
        | "LOST"
        | "REOPENED"
        | "ARCHIVED"
        | "RESTORED"
      opportunity_stage:
        | "new"
        | "qualified"
        | "selection"
        | "quoted"
        | "negotiation"
        | "verbal_confirmation"
        | "won"
        | "lost"
        | "nurture"
      product_category:
        | "TILES"
        | "MARBLE"
        | "GRANITE"
        | "SANITARYWARE"
        | "CP_FITTINGS"
        | "ALLIED"
        | "MIXED"
      project_status: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ABANDONED"
      project_type:
        | "INDIVIDUAL_HOUSE"
        | "VILLA"
        | "APARTMENT_UNIT"
        | "APARTMENT_PROJECT"
        | "COMMERCIAL"
        | "HOSPITALITY"
        | "INSTITUTIONAL"
        | "RENOVATION"
        | "OTHER"
      quantity_unit: "SQFT" | "SQM" | "NOS" | "SET" | "BOX"
      quotation_status:
        | "NONE"
        | "PREPARING"
        | "SENT"
        | "UNDER_DISCUSSION"
        | "REVISED"
        | "ACCEPTED"
        | "REJECTED"
        | "EXPIRED"
      stakeholder_role:
        | "OWNER_BUYER"
        | "SPOUSE_FAMILY"
        | "ARCHITECT"
        | "INTERIOR_DESIGNER"
        | "CONTRACTOR"
        | "BUILDER"
        | "SITE_ENGINEER"
        | "MASON"
        | "PURCHASE_MANAGER"
        | "DEALER"
        | "OTHER"
      user_role: "SALESPERSON" | "MANAGER" | "OWNER" | "ADMIN"
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
      account_status: ["PROSPECT", "ACTIVE", "DORMANT", "DO_NOT_CONTACT"],
      account_type: [
        "HOMEOWNER",
        "CONTRACTOR",
        "BUILDER",
        "ARCHITECT",
        "INTERIOR_DESIGNER",
        "DEALER",
        "COMMERCIAL",
        "MASON",
        "OTHER",
      ],
      activity_outcome: [
        "POSITIVE",
        "NEUTRAL",
        "NEGATIVE",
        "NO_RESPONSE",
        "RESCHEDULED",
      ],
      activity_purpose: [
        "ENQUIRY",
        "FOLLOW_UP",
        "PRODUCT_DISCUSSION",
        "SITE_MEASUREMENT",
        "SAMPLE_HANDOVER",
        "QUOTATION_DISCUSSION",
        "PRICE_NEGOTIATION",
        "ORDER_CONFIRMATION",
        "RELATIONSHIP",
        "OTHER",
      ],
      activity_type: [
        "CALL",
        "WHATSAPP",
        "SHOWROOM_VISIT",
        "SITE_VISIT",
        "MEETING",
        "EMAIL",
        "NOTE",
      ],
      construction_stage: [
        "PLANNING",
        "FOUNDATION",
        "STRUCTURE",
        "BRICKWORK",
        "PLASTERING",
        "FLOORING_STAGE",
        "FINISHING",
        "COMPLETED",
        "RENOVATION",
        "UNKNOWN",
      ],
      contact_channel: ["CALL", "WHATSAPP", "IN_PERSON", "EMAIL"],
      import_row_status: [
        "VALID",
        "WARNING",
        "ERROR",
        "DUPLICATE_EXACT",
        "DUPLICATE_POSSIBLE",
        "IMPORTED",
        "SKIPPED",
      ],
      import_status: [
        "UPLOADED",
        "VALIDATING",
        "REVIEW",
        "IMPORTING",
        "COMPLETED",
        "FAILED",
        "ROLLED_BACK",
      ],
      influence_level: [
        "DECISION_MAKER",
        "STRONG_INFLUENCER",
        "INFLUENCER",
        "EXECUTOR",
        "INFORMATION_ONLY",
      ],
      lead_source: [
        "WALK_IN",
        "PHONE_ENQUIRY",
        "CUSTOMER_REFERRAL",
        "ARCHITECT_REFERRAL",
        "CONTRACTOR_REFERRAL",
        "SIGNAGE",
        "SOCIAL_MEDIA",
        "EXHIBITION",
        "EXISTING_CUSTOMER",
        "OTHER",
      ],
      lost_reason: [
        "PRICE",
        "STOCK_UNAVAILABLE",
        "DELIVERY_TIME",
        "DESIGN_NOT_AVAILABLE",
        "COMPETITOR_RELATIONSHIP",
        "PROJECT_POSTPONED",
        "PROJECT_CANCELLED",
        "BUDGET_CUT",
        "SPECIFIED_OTHER_BRAND",
        "CREDIT_TERMS",
        "SERVICE_RESPONSE",
        "NOT_GENUINE",
        "NO_RESPONSE",
        "UNKNOWN",
      ],
      next_action_type: [
        "CALL",
        "SHOWROOM_VISIT",
        "SITE_VISIT",
        "SEND_QUOTATION",
        "SHARE_SAMPLES",
        "QUOTATION_FOLLOWUP",
        "PRICE_DISCUSSION",
        "AWAIT_CUSTOMER",
        "OTHER",
      ],
      opportunity_event_type: [
        "CREATED",
        "STAGE_CHANGED",
        "OWNER_CHANGED",
        "WON",
        "LOST",
        "REOPENED",
        "ARCHIVED",
        "RESTORED",
      ],
      opportunity_stage: [
        "new",
        "qualified",
        "selection",
        "quoted",
        "negotiation",
        "verbal_confirmation",
        "won",
        "lost",
        "nurture",
      ],
      product_category: [
        "TILES",
        "MARBLE",
        "GRANITE",
        "SANITARYWARE",
        "CP_FITTINGS",
        "ALLIED",
        "MIXED",
      ],
      project_status: ["ACTIVE", "ON_HOLD", "COMPLETED", "ABANDONED"],
      project_type: [
        "INDIVIDUAL_HOUSE",
        "VILLA",
        "APARTMENT_UNIT",
        "APARTMENT_PROJECT",
        "COMMERCIAL",
        "HOSPITALITY",
        "INSTITUTIONAL",
        "RENOVATION",
        "OTHER",
      ],
      quantity_unit: ["SQFT", "SQM", "NOS", "SET", "BOX"],
      quotation_status: [
        "NONE",
        "PREPARING",
        "SENT",
        "UNDER_DISCUSSION",
        "REVISED",
        "ACCEPTED",
        "REJECTED",
        "EXPIRED",
      ],
      stakeholder_role: [
        "OWNER_BUYER",
        "SPOUSE_FAMILY",
        "ARCHITECT",
        "INTERIOR_DESIGNER",
        "CONTRACTOR",
        "BUILDER",
        "SITE_ENGINEER",
        "MASON",
        "PURCHASE_MANAGER",
        "DEALER",
        "OTHER",
      ],
      user_role: ["SALESPERSON", "MANAGER", "OWNER", "ADMIN"],
    },
  },
} as const
