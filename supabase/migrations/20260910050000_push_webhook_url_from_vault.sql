-- ═══════════════════════════════════════════════════════════════
-- Web Push の送信先を Vault から読むようにする
--   これまでは送信先のURLが関数の中に直書きされていたため、DBの置き場所を
--   移すと配信だけが黙って止まった（実際、PCへ移してから配信の試行が0件だった）。
--   送信先も合言葉と同じように Vault から読み、無ければ警告して何もしない。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  webhook_secret TEXT;
  webhook_url TEXT;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_secret'
   ORDER BY created_at DESC LIMIT 1;

  SELECT decrypted_secret INTO webhook_url
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_url'
   ORDER BY created_at DESC LIMIT 1;

  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING 'push_webhook_secret is not configured; push delivery skipped';
    RETURN NEW;
  END IF;

  IF webhook_url IS NULL OR webhook_url = '' THEN
    RAISE WARNING 'push_webhook_url is not configured; push delivery skipped';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
END;
$$;

NOTIFY pgrst,'reload schema';
