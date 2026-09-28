-- Apply after checking existing subscriptions. No subscriptions are removed.
CREATE OR REPLACE FUNCTION public.is_allowed_push_endpoint(endpoint text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(length(endpoint) <= 4096 AND endpoint ~
    '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])?push[.]apple[.]com)/[^[:space:]\\#]+$', false)
$$;

ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscription_endpoint_allowed;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscription_endpoint_allowed
  CHECK (public.is_allowed_push_endpoint(endpoint));
