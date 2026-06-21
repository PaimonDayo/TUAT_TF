-- 通知INSERT時に Edge Function (send-web-push) を呼ぶ。
-- Database Webhooks 機構（supabase_functions スキーマ）が未provisionのため、
-- pg_net を直接使うトリガー関数で実装する（自己完結）。
-- send-web-push は --no-verify-jwt デプロイ済みのため Authorization 不要。
-- 送信ペイロードは Edge Function が期待する {type, table, record} 形式。

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.send_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://snbgxocgdhqtuywrlqrs.supabase.co/functions/v1/send-web-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_created_send_push ON notifications;
CREATE TRIGGER on_notification_created_send_push
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION public.send_notification_push();
