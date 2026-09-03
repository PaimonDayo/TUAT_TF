-- ito is permanently retired. Remove its data, RPCs, notification variants,
-- and Realtime publication entries. Historical migration files remain as the
-- immutable record of how production reached this state.

DELETE FROM public.notifications
WHERE type = 'ito_invite' OR reference_type = 'ito';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment', 'notice', 'schedule_update', 'sync_failure', 'thread_reply', 'mention'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_reference_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('record', 'tweet', 'schedule', 'notice', 'thread'));

DO $$
BEGIN
  IF to_regclass('public.ito_invitations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ito_invitation_notification ON public.ito_invitations;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.handle_ito_invitation_notification();
DROP FUNCTION IF EXISTS public.ito_apply_scores(UUID, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.ito_set_order(UUID, UUID[], INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.ito_secret_status(UUID);
DROP FUNCTION IF EXISTS public.ito_confirm_secret(UUID);
DROP FUNCTION IF EXISTS public.ito_assign_secrets(UUID);
DROP FUNCTION IF EXISTS public.ito_set_leader(UUID, UUID);
DROP FUNCTION IF EXISTS public.ito_respond_invitation(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.ito_advance_phase(UUID, TEXT);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'ito_games', 'ito_invitations', 'ito_participants', 'ito_rounds', 'ito_groups',
      'ito_group_members', 'ito_leader_answers', 'ito_group_orders',
      'ito_round_scores', 'ito_point_events'
    ] LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.ito_point_events;
DROP TABLE IF EXISTS public.ito_round_scores;
DROP TABLE IF EXISTS public.ito_group_orders;
DROP TABLE IF EXISTS public.ito_leader_answers;
DROP TABLE IF EXISTS public.ito_secrets;
DROP TABLE IF EXISTS public.ito_group_members;
DROP TABLE IF EXISTS public.ito_groups;
DROP TABLE IF EXISTS public.ito_rounds;
DROP TABLE IF EXISTS public.ito_participants;
DROP TABLE IF EXISTS public.ito_invitations;
DROP TABLE IF EXISTS public.ito_games;

-- RLS policies that depended on these helpers disappeared with the tables.
DROP FUNCTION IF EXISTS public.ito_can_edit_group(UUID);
DROP FUNCTION IF EXISTS public.ito_can_read_group(UUID);
DROP FUNCTION IF EXISTS public.ito_is_in_round(UUID);
DROP FUNCTION IF EXISTS public.ito_is_leader_in_round(UUID);
DROP FUNCTION IF EXISTS public.ito_group_round(UUID);
DROP FUNCTION IF EXISTS public.ito_round_phase(UUID);
