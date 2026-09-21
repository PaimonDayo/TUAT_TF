-- Scope test delivery to a subscription owned by the caller; legacy RPC remains compatible.
CREATE OR REPLACE FUNCTION public.send_test_push_to_subscription(subscription_endpoint TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  webhook_secret TEXT;
  webhook_url TEXT;
  selected_subscription UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id INTO selected_subscription
  FROM public.push_subscriptions
  WHERE user_id = current_user_id AND endpoint = subscription_endpoint;

  IF selected_subscription IS NULL THEN
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
    RETURN jsonb_build_object('sent', false, 'reason', 'not_configured', 'subscriptions', 1);
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
        'subscription_id', selected_subscription,
        'reference_type', NULL,
        'reference_id', NULL,
        'is_read', true,
        'created_at', NOW()
      )
    )
  );

  RETURN jsonb_build_object('sent', true, 'subscriptions', 1);
END;
$$;

REVOKE ALL ON FUNCTION public.send_test_push_to_subscription(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_test_push_to_subscription(TEXT) TO authenticated;

NOTIFY pgrst,'reload schema';

REVOKE ALL ON FUNCTION public.send_test_push_to_subscription(TEXT) FROM anon;
