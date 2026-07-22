-- The deployment-only Vault configurator is removed after its one-time use.
DROP FUNCTION IF EXISTS public.configure_push_webhook_secret(TEXT);
