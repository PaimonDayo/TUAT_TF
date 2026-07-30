-- Push subscription self-healing support.
--
-- 1. push_subscriptions.last_seen_at: additive column that records the last time
--    the device re-registered itself. The app now reconciles on every session,
--    so a stale last_seen_at means "this member has not opened the app with a
--    working subscription since then" (the only observability we have today).
-- 2. register_push_subscription: unchanged behaviour, plus it refreshes
--    last_seen_at on conflict. Grants restated so the function keeps the same
--    permissions after CREATE OR REPLACE.
-- 3. send_test_push: lets a signed-in member send one real push to their OWN
--    devices ("通知が届くか試す" button). It reuses the existing Vault secret and
--    the deployed send-web-push Edge Function, so no VAPID secret has to be
--    copied into the web app. It never inserts a notifications row, so the
--    notification centre stays clean.
--
-- Additive only: no row is deleted anywhere in this migration.

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  subscription_endpoint TEXT,
  subscription_p256dh TEXT,
  subscription_auth TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF subscription_endpoint IS NULL OR subscription_endpoint = ''
     OR subscription_p256dh IS NULL OR subscription_p256dh = ''
     OR subscription_auth IS NULL OR subscription_auth = '' THEN
    RAISE EXCEPTION 'Invalid push subscription';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (current_user_id, subscription_endpoint, subscription_p256dh, subscription_auth)
  ON CONFLICT (endpoint) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    last_seen_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

-- Sends one test push to the caller's own subscriptions only. The payload is
-- built from auth.uid() inside the function, so a caller cannot address anyone
-- else's devices. Delivery itself is asynchronous (pg_net), so the return value
-- reports whether the request was handed off, not whether the phone rang.
CREATE OR REPLACE FUNCTION public.send_test_push()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  webhook_secret TEXT;
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

  SELECT decrypted_secret
  INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_webhook_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'not_configured', 'subscriptions', subscription_count);
  END IF;

  PERFORM net.http_post(
    url := 'https://snbgxocgdhqtuywrlqrs.supabase.co/functions/v1/send-web-push',
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
