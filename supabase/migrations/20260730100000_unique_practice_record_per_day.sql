-- A member has at most one practice record per calendar day.
-- The application and sheet sync both use (user_id, recorded_date) as the
-- identity of a practice record, so enforce that invariant in the database.
ALTER TABLE public.practice_records
  ADD CONSTRAINT practice_records_user_recorded_date_key
  UNIQUE (user_id, recorded_date);
