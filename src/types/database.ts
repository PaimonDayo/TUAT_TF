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
      attendances: {
        Row: {
          created_at: string
          id: string
          is_late: boolean
          late_note: string | null
          schedule_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_late?: boolean
          late_note?: string | null
          schedule_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_late?: boolean
          late_note?: string | null
          schedule_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendances_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "practice_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          sheet_reply_index: number | null
          created_at: string
          id: string
          target_id: string
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          sheet_reply_index?: number | null
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          sheet_reply_index?: number | null
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_entries: {
        Row: {
          created_at: string
          event_date: string | null
          events: string | null
          id: string
          note: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          events?: string | null
          id?: string
          note?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_date?: string | null
          events?: string | null
          id?: string
          note?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          favorite_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          favorite_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          favorite_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_favorite_user_id_fkey"
            columns: ["favorite_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_favorite_user_id_fkey"
            columns: ["favorite_user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      google_drive_connections: {
        Row: {
          connected_at: string
          google_email: string | null
          profile_id: string
          refresh_token_encrypted: string
          updated_at: string
        }
        Insert: {
          connected_at?: string
          google_email?: string | null
          profile_id: string
          refresh_token_encrypted: string
          updated_at?: string
        }
        Update: {
          connected_at?: string
          google_email?: string | null
          profile_id?: string
          refresh_token_encrypted?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_drive_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_drive_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string
          id: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_target_presets: {
        Row: {
          author_id: string
          created_at: string
          id: string
          name: string
          user_ids: string[]
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          name: string
          user_ids?: string[]
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          name?: string
          user_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "menu_target_presets_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_target_presets_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      note_articles: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          note_id: string
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          note_id: string
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          note_id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_articles_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_editors: {
        Row: {
          note_id: string
          user_id: string
        }
        Insert: {
          note_id: string
          user_id: string
        }
        Update: {
          note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_editors_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_editors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_editors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      note_themes: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          sort: number
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          sort?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_themes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_themes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          description: string | null
          edit_policy: string
          id: string
          parent_id: string | null
          pinned: boolean
          scope: string
          status: string
          theme_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          description?: string | null
          edit_policy?: string
          id?: string
          parent_id?: string | null
          pinned?: boolean
          scope: string
          status?: string
          theme_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          description?: string | null
          edit_policy?: string
          id?: string
          parent_id?: string | null
          pinned?: boolean
          scope?: string
          status?: string
          theme_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "note_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_dismissals: {
        Row: {
          created_at: string
          notice_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notice_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          notice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_dismissals_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reactions: {
        Row: {
          created_at: string
          notice_id: string
          reaction: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notice_id: string
          reaction: string
          user_id: string
        }
        Update: {
          created_at?: string
          notice_id?: string
          reaction?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reactions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          author_id: string
          category: string
          content: string
          created_at: string
          deadline: string | null
          id: string
          mentioned_all: boolean
          mentioned_blocks: string[]
          mentioned_grades: string[]
          mentioned_role_ids: string[]
          mentioned_user_ids: string[]
          notify_members: boolean
          pin_home: boolean
          target_role_ids: string[]
          title: string
        }
        Insert: {
          author_id: string
          category: string
          content: string
          created_at?: string
          deadline?: string | null
          id?: string
          mentioned_all?: boolean
          mentioned_blocks?: string[]
          mentioned_grades?: string[]
          mentioned_role_ids?: string[]
          mentioned_user_ids?: string[]
          notify_members?: boolean
          pin_home?: boolean
          target_role_ids?: string[]
          title: string
        }
        Update: {
          author_id?: string
          category?: string
          content?: string
          created_at?: string
          deadline?: string | null
          id?: string
          mentioned_all?: boolean
          mentioned_blocks?: string[]
          mentioned_grades?: string[]
          mentioned_role_ids?: string[]
          mentioned_user_ids?: string[]
          notify_members?: boolean
          pin_home?: boolean
          target_role_ids?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          is_read: boolean
          reference_id: string | null
          reference_type: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          reference_id?: string | null
          reference_type?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          reference_id?: string | null
          reference_type?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      pb_records: {
        Row: {
          created_at: string
          event_name: string
          id: string
          is_official: boolean
          is_pb: boolean
          is_ub: boolean
          meet_name: string | null
          record: string
          recorded_on: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          is_official?: boolean
          is_pb?: boolean
          is_ub?: boolean
          meet_name?: string | null
          record: string
          recorded_on?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          is_official?: boolean
          is_pb?: boolean
          is_ub?: boolean
          meet_name?: string | null
          record?: string
          recorded_on?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pb_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pb_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_menu_targets: {
        Row: {
          menu_id: string
          user_id: string
        }
        Insert: {
          menu_id: string
          user_id: string
        }
        Update: {
          menu_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_menu_targets_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "practice_menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_menu_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_menu_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_menus: {
        Row: {
          author_id: string
          content: string
          created_at: string
          group_name: string | null
          id: string
          pace: string | null
          remark: string | null
          schedule_id: string
          status: string
          supplement: string | null
          target_block: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          group_name?: string | null
          id?: string
          pace?: string | null
          remark?: string | null
          schedule_id: string
          status?: string
          supplement?: string | null
          target_block?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          group_name?: string | null
          id?: string
          pace?: string | null
          remark?: string | null
          schedule_id?: string
          status?: string
          supplement?: string | null
          target_block?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_menus_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_menus_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_menus_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "practice_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_records: {
        Row: {
          condition: string | null
          created_at: string
          custom: Json
          dist_high: number | null
          dist_low: number | null
          dist_mid: number | null
          dist_speed: number | null
          focus_text: string | null
          from_sheet: boolean
          id: string
          likes_count: number
          memo: string | null
          menu_text: string | null
          pending_sheet_push: boolean
          recorded_date: string
          result_text: string | null
          strength_text: string | null
          strides: number | null
          synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          condition?: string | null
          created_at?: string
          custom?: Json
          dist_high?: number | null
          dist_low?: number | null
          dist_mid?: number | null
          dist_speed?: number | null
          focus_text?: string | null
          from_sheet?: boolean
          id?: string
          likes_count?: number
          memo?: string | null
          menu_text?: string | null
          pending_sheet_push?: boolean
          recorded_date: string
          result_text?: string | null
          strength_text?: string | null
          strides?: number | null
          synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          condition?: string | null
          created_at?: string
          custom?: Json
          dist_high?: number | null
          dist_low?: number | null
          dist_mid?: number | null
          dist_speed?: number | null
          focus_text?: string | null
          from_sheet?: boolean
          id?: string
          likes_count?: number
          memo?: string | null
          menu_text?: string | null
          pending_sheet_push?: boolean
          recorded_date?: string
          result_text?: string | null
          strength_text?: string | null
          strides?: number | null
          synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_schedules: {
        Row: {
          created_at: string
          created_by: string
          end_date: string | null
          entry_end: string | null
          entry_start: string | null
          id: string
          location: string | null
          meeting_time: string | null
          note: string | null
          schedule_date: string
          schedule_type: string
          source_sheet_id: string | null
          target_blocks: string[]
          title: string | null
          venue_access: string | null
          venue_fee: string | null
          venue_name: string | null
          venue_url: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          end_date?: string | null
          entry_end?: string | null
          entry_start?: string | null
          id?: string
          location?: string | null
          meeting_time?: string | null
          note?: string | null
          schedule_date: string
          schedule_type: string
          source_sheet_id?: string | null
          target_blocks?: string[]
          title?: string | null
          venue_access?: string | null
          venue_fee?: string | null
          venue_name?: string | null
          venue_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          end_date?: string | null
          entry_end?: string | null
          entry_start?: string | null
          id?: string
          location?: string | null
          meeting_time?: string | null
          note?: string | null
          schedule_date?: string
          schedule_type?: string
          source_sheet_id?: string | null
          target_blocks?: string[]
          title?: string | null
          venue_access?: string | null
          venue_fee?: string | null
          venue_name?: string | null
          venue_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_schedules_source_sheet_id_fkey"
            columns: ["source_sheet_id"]
            isOneToOne: false
            referencedRelation: "schedule_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_roles: {
        Row: {
          created_at: string
          profile_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          attendance_default_block: string
          attendance_view_all_blocks: boolean
          avatar_url: string | null
          blocks: string[]
          created_at: string
          display_name: string
          email: string
          events: string[]
          goal: string | null
          grade: string | null
          id: string
          menu_view_all_blocks: boolean
          notify_comment: boolean
          notify_notice: boolean
          record_fields: Json
          record_source: string
          role: string
          sheet_linked_at: string | null
          sheet_name: string | null
          status: string
        }
        Insert: {
          approved?: boolean
          attendance_default_block?: string
          attendance_view_all_blocks?: boolean
          avatar_url?: string | null
          blocks?: string[]
          created_at?: string
          display_name?: string
          email: string
          events?: string[]
          goal?: string | null
          grade?: string | null
          id: string
          menu_view_all_blocks?: boolean
          notify_comment?: boolean
          notify_notice?: boolean
          record_fields?: Json
          record_source?: string
          role?: string
          sheet_linked_at?: string | null
          sheet_name?: string | null
          status?: string
        }
        Update: {
          approved?: boolean
          attendance_default_block?: string
          attendance_view_all_blocks?: boolean
          avatar_url?: string | null
          blocks?: string[]
          created_at?: string
          display_name?: string
          email?: string
          events?: string[]
          goal?: string | null
          grade?: string | null
          id?: string
          menu_view_all_blocks?: boolean
          notify_comment?: boolean
          notify_notice?: boolean
          record_fields?: Json
          record_source?: string
          role?: string
          sheet_linked_at?: string | null
          sheet_name?: string | null
          status?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      role_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      roles: {
        Row: {
          can_create_menu: boolean
          can_create_notice: boolean
          can_create_schedule: boolean
          can_manage_members: boolean
          can_manage_system: boolean
          category: string | null
          color: string
          created_at: string
          id: string
          is_everyone: boolean
          is_system: boolean
          name: string
          sort_order: number
        }
        Insert: {
          can_create_menu?: boolean
          can_create_notice?: boolean
          can_create_schedule?: boolean
          can_manage_members?: boolean
          can_manage_system?: boolean
          category?: string | null
          color?: string
          created_at?: string
          id?: string
          is_everyone?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          can_create_menu?: boolean
          can_create_notice?: boolean
          can_create_schedule?: boolean
          can_manage_members?: boolean
          can_manage_system?: boolean
          category?: string | null
          color?: string
          created_at?: string
          id?: string
          is_everyone?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      schedule_sheets: {
        Row: {
          author_id: string
          created_at: string
          csv_url: string | null
          id: string
          kind: string
          last_imported_at: string | null
          sheet_url: string
          status: string
          target_block: string
          target_month: number | null
          target_year: number | null
        }
        Insert: {
          author_id: string
          created_at?: string
          csv_url?: string | null
          id?: string
          kind: string
          last_imported_at?: string | null
          sheet_url: string
          status?: string
          target_block?: string
          target_month?: number | null
          target_year?: number | null
        }
        Update: {
          author_id?: string
          created_at?: string
          csv_url?: string | null
          id?: string
          kind?: string
          last_imported_at?: string | null
          sheet_url?: string
          status?: string
          target_block?: string
          target_month?: number | null
          target_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_sheets_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sheets_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_record_replies: {
        Row: {
          content: string
          id: string
          owner_id: string
          record_id: string
          recorded_date: string
          reply_index: number
          synced_at: string
        }
        Insert: {
          content: string
          id?: string
          owner_id: string
          record_id: string
          recorded_date: string
          reply_index: number
          synced_at?: string
        }
        Update: {
          content?: string
          id?: string
          owner_id?: string
          record_id?: string
          recorded_date?: string
          reply_index?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_record_replies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_record_replies_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "practice_records"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_sync_runs: {
        Row: {
          alerted_at: string | null
          chunk_end: number | null
          chunk_start: number | null
          cycle_complete: boolean
          total_members: number | null
          error_text: string | null
          failed_members: Json
          finished_at: string | null
          id: string
          menu_count: number
          pulled_count: number
          pushed_count: number
          started_at: string
          status: string
          trigger: string
          triggered_by: string | null
        }
        Insert: {
          alerted_at?: string | null
          chunk_end?: number | null
          chunk_start?: number | null
          cycle_complete?: boolean
          total_members?: number | null
          error_text?: string | null
          failed_members?: Json
          finished_at?: string | null
          id?: string
          menu_count?: number
          pulled_count?: number
          pushed_count?: number
          started_at?: string
          status?: string
          trigger?: string
          triggered_by?: string | null
        }
        Update: {
          alerted_at?: string | null
          chunk_end?: number | null
          chunk_start?: number | null
          cycle_complete?: boolean
          total_members?: number | null
          error_text?: string | null
          failed_members?: Json
          finished_at?: string | null
          id?: string
          menu_count?: number
          pulled_count?: number
          pushed_count?: number
          started_at?: string
          status?: string
          trigger?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_sync_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_sync_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          author_id: string
          created_at: string
          folder_id: string | null
          id: string
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          created_at?: string
          folder_id?: string | null
          id?: string
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          folder_id?: string | null
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      tweets: {
        Row: {
          content: string
          created_at: string
          id: string
          likes_count: number
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          likes_count?: number
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          likes_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tweets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tweets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_ranking"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          access: string | null
          created_at: string
          fee: string | null
          id: string
          name: string
          pinned: boolean
          short: string | null
          sort: number
          url: string | null
        }
        Insert: {
          access?: string | null
          created_at?: string
          fee?: string | null
          id?: string
          name: string
          pinned?: boolean
          short?: string | null
          sort?: number
          url?: string | null
        }
        Update: {
          access?: string | null
          created_at?: string
          fee?: string | null
          id?: string
          name?: string
          pinned?: boolean
          short?: string | null
          sort?: number
          url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      weekly_ranking: {
        Row: {
          avatar_url: string | null
          blocks: string[] | null
          display_name: string | null
          grade: string | null
          id: string | null
          km_high: number | null
          km_low: number | null
          km_mid: number | null
          km_speed: number | null
          period_end: string | null
          period_start: string | null
          total_km: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_sheet_sync_chunk: {
        Args: { requested_chunk_size?: number; reset_cycle?: boolean }
        Returns: Json
      }
      apply_schedule_sheet_import: {
        Args: { import_rows: Json; target_sheet_id: string }
        Returns: undefined
      }
      can_create_menu: { Args: never; Returns: boolean }
      can_create_notice: { Args: never; Returns: boolean }
      can_create_schedule: { Args: never; Returns: boolean }
      can_edit_note: { Args: { target_note_id: string }; Returns: boolean }
      can_manage_members: { Args: never; Returns: boolean }
      can_manage_system: { Args: never; Returns: boolean }
      can_view_note: { Args: { target_note_id: string }; Returns: boolean }
      can_view_practice_menu: {
        Args: { target_menu_id: string }
        Returns: boolean
      }
      count_comments_by_target: {
        Args: { target_ids: string[]; target_type_in: string }
        Returns: {
          count: number
          target_id: string
        }[]
      }
      delete_custom_role: { Args: { target_role_id: string }; Returns: boolean }
      ensure_practice_schedule_for_menu: {
        Args: { target_date: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      notify_sync_failure_if_needed: {
        Args: { current_run_id: string }
        Returns: number
      }
      reorder_roles: { Args: { role_ids: string[] }; Returns: undefined }
      register_push_subscription: {
        Args: { subscription_endpoint: string; subscription_p256dh: string; subscription_auth: string }
        Returns: undefined
      }
      replace_sheet_record_replies: {
        Args: { reply_rows: Json; target_record_id: string }
        Returns: undefined
      }
      reset_sheet_sync_cursor: { Args: never; Returns: undefined }
      reorder_venues: { Args: { venue_ids: string[] }; Returns: undefined }
      save_practice_menu: {
        Args: {
          menu_content: string
          menu_pace?: string
          menu_remark?: string
          menu_status: string
          menu_supplement?: string
          menu_target_block?: string
          target_menu_id?: string
          target_schedule_id: string
          target_user_ids?: string[]
        }
        Returns: string
      }
      set_member_approved: {
        Args: { target_profile_id: string; value: boolean }
        Returns: undefined
      }
      set_profile_roles: {
        Args: { target_profile_id: string; target_role_ids: string[] }
        Returns: undefined
      }
      set_role_members: {
        Args: { target_profile_ids: string[]; target_role_id: string }
        Returns: undefined
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
