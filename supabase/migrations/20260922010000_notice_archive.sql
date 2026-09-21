-- Archive preserves the notice, reactions and notifications. Existing UPDATE
-- policy restricts changes to authenticated users with can_create_notice().
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS archived_at timestamptz;
