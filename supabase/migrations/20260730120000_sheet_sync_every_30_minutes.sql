-- Run the existing practice-record sheet sync twice per hour.
-- The endpoint now processes up to 30 linked members per invocation.
DO $$
DECLARE
  sync_job_id BIGINT;
BEGIN
  SELECT jobid
    INTO sync_job_id
  FROM cron.job
  WHERE jobname = 'sheet-sync-hourly';

  IF sync_job_id IS NULL THEN
    RAISE EXCEPTION 'pg_cron job sheet-sync-hourly was not found';
  END IF;

  PERFORM cron.alter_job(
    sync_job_id,
    schedule := '*/30 * * * *'
  );
END;
$$;
