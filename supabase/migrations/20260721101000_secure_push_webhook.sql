-- Authenticate database-to-Edge-Function push calls with a shared secret.
-- Before deploying this migration, create the same random value in:
--   1. Supabase Vault with name push_webhook_secret
--   2. Edge Function secret PUSH_WEBHOOK_SECRET
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION public.send_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  webhook_secret TEXT;
BEGIN
  SELECT decrypted_secret
  INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_webhook_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING 'push_webhook_secret is not configured; push delivery skipped';
    RETURN NEW;
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
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.send_notification_push() FROM PUBLIC;

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
    auth = EXCLUDED.auth;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

-- Temporary service-role-only hook used during deployment to put the webhook
-- secret into Vault without storing the value in source control.
CREATE OR REPLACE FUNCTION public.configure_push_webhook_secret(webhook_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_secret_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF webhook_secret IS NULL OR char_length(webhook_secret) < 32 THEN
    RAISE EXCEPTION 'Webhook secret must be at least 32 characters';
  END IF;

  SELECT id INTO existing_secret_id
  FROM vault.secrets
  WHERE name = 'push_webhook_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      webhook_secret,
      'push_webhook_secret',
      'Authenticates notification trigger calls to send-web-push'
    );
  ELSE
    PERFORM vault.update_secret(
      existing_secret_id,
      webhook_secret,
      'push_webhook_secret',
      'Authenticates notification trigger calls to send-web-push'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_push_webhook_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_push_webhook_secret(TEXT) TO service_role;
