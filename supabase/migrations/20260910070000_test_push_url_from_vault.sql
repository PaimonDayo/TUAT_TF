-- ═══════════════════════════════════════════════════════════════
-- 「通知が届くか試す」も、送信先を Vault から読む
--   トリガー側（20260910050000）は直したが、この確認用RPCには凍結中の旧クラウドの
--   URLが直書きのまま残っていた。押しても旧クラウドへ飛ぶだけで、
--   何も届かないのに「送信しました」と返っていた。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_test_push()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  webhook_secret TEXT;
  webhook_url TEXT;
  subscription_count INT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT COUNT(*) INTO subscription_count
  FROM public.push_subscriptions
  WHERE user_id = current_user_id;

  IF subscription_count = 0 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_subscription', 'subscriptions', 0);
  END IF;

  SELECT decrypted_secret INTO webhook_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_secret'
   ORDER BY created_at DESC LIMIT 1;

  SELECT decrypted_secret INTO webhook_url
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_url'
   ORDER BY created_at DESC LIMIT 1;

  IF webhook_secret IS NULL OR webhook_secret = ''
     OR webhook_url IS NULL OR webhook_url = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'not_configured', 'subscriptions', subscription_count);
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
      'record', jsonb_build_object(
        'id', gen_random_uuid(),
        'user_id', current_user_id,
        'actor_id', NULL,
        'type', 'test',
        'reference_type', NULL,
        'reference_id', NULL,
        'is_read', true,
        'created_at', NOW()
      )
    )
  );

  RETURN jsonb_build_object('sent', true, 'subscriptions', subscription_count);
END;
$$;

REVOKE ALL ON FUNCTION public.send_test_push() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_test_push() TO authenticated;

NOTIFY pgrst,'reload schema';
