-- ito_respond_invitation() の所有者チェックを厳密にする。
-- 未ログイン（auth.uid() が NULL）だと `inv.profile_id <> auth.uid()` が NULL になり
-- IF が成立せず、招待IDさえ分かれば他人の招待に回答できてしまう状態だった。
-- SECURITY DEFINER なので RLS では止まらない。NULL を明示的に弾く。
CREATE OR REPLACE FUNCTION public.ito_respond_invitation(invitation_id UUID, accept BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.ito_invitations%ROWTYPE;
  next_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO inv FROM public.ito_invitations WHERE id = invitation_id FOR UPDATE;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF inv.profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not your invitation';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation already answered';
  END IF;

  next_status := CASE WHEN accept THEN 'joined' ELSE 'declined' END;

  UPDATE public.ito_invitations
  SET status = next_status, responded_at = now()
  WHERE id = invitation_id;

  IF accept THEN
    INSERT INTO public.ito_participants (game_id, profile_id, status, joined_round, updated_at)
    VALUES (inv.game_id, inv.profile_id, 'active', inv.round_no, now())
    ON CONFLICT (game_id, profile_id) DO UPDATE
      SET status = 'active', left_round = NULL, updated_at = now();
  END IF;

  RETURN next_status;
END;
$$;
