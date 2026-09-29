-- The named 管理者 role, not unrelated permission flags, moderates comments.
CREATE OR REPLACE FUNCTION public.can_moderate_comments() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.profile_roles pr
 JOIN public.roles r ON r.id=pr.role_id WHERE pr.profile_id=auth.uid() AND r.name='管理者')
$$;
REVOKE ALL ON FUNCTION public.can_moderate_comments() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_moderate_comments() TO authenticated;
DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments FOR DELETE TO authenticated
 USING(auth.uid() IS NOT NULL AND (user_id=auth.uid() OR public.can_moderate_comments()));

-- Durable deletion receipts prevent stale sheet reads from resurrecting replies.
-- No FKs: receipts must survive removal of their source record/comment.
CREATE TABLE IF NOT EXISTS public.sheet_reply_deletions (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('app','sheet')),
 actor_id uuid, record_id uuid NOT NULL, sheet_name text NOT NULL,
 recorded_date date NOT NULL, reply_index integer, expected_content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 CHECK(reply_index IS NULL OR reply_index>=0)
);
ALTER TABLE public.sheet_reply_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sheet_reply_deletions FROM anon,authenticated;
GRANT SELECT ON public.sheet_reply_deletions TO authenticated;
GRANT ALL ON public.sheet_reply_deletions TO service_role;
DROP POLICY IF EXISTS sheet_reply_deletions_read ON public.sheet_reply_deletions;
CREATE POLICY sheet_reply_deletions_read ON public.sheet_reply_deletions FOR SELECT TO authenticated
 USING(actor_id=auth.uid() OR public.can_moderate_comments());
CREATE INDEX IF NOT EXISTS sheet_reply_deletions_record ON public.sheet_reply_deletions(record_id);
CREATE INDEX IF NOT EXISTS sheet_reply_deletions_pending ON public.sheet_reply_deletions(created_at) WHERE processed_at IS NULL;
DROP TRIGGER IF EXISTS zz_log_failover_change ON public.sheet_reply_deletions;
CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.sheet_reply_deletions
 FOR EACH ROW EXECUTE FUNCTION public.log_failover_change('id');

CREATE OR REPLACE FUNCTION public.queue_comment_sheet_deletion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target record; name text; expected text;
BEGIN
 IF OLD.target_type<>'record' OR public.is_mirror_write() OR auth.uid() IS NULL THEN RETURN OLD; END IF;
 SELECT p.sheet_name,r.recorded_date INTO target FROM public.practice_records r
 JOIN public.profiles p ON p.id=r.user_id WHERE r.id=OLD.target_id;
 IF target.sheet_name IS NULL THEN RETURN OLD; END IF;
 SELECT display_name INTO name FROM public.profiles WHERE id=OLD.user_id;
 SELECT content INTO expected FROM public.sheet_record_replies WHERE record_id=OLD.target_id AND reply_index=OLD.sheet_reply_index;
 expected:=coalesce(expected,btrim(OLD.content)||CASE WHEN btrim(coalesce(name,''))='' THEN '' ELSE '　'||btrim(name) END);
 INSERT INTO public.sheet_reply_deletions(id,kind,actor_id,record_id,sheet_name,recorded_date,reply_index,expected_content)
 VALUES(OLD.id,'app',auth.uid(),OLD.target_id,target.sheet_name,target.recorded_date,OLD.sheet_reply_index,expected)
 ON CONFLICT(id) DO NOTHING;
 DELETE FROM public.sheet_record_replies WHERE record_id=OLD.target_id AND
 ((OLD.sheet_reply_index IS NOT NULL AND reply_index=OLD.sheet_reply_index) OR content=expected);
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.queue_comment_sheet_deletion() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS queue_comment_sheet_deletion ON public.comments;
CREATE TRIGGER queue_comment_sheet_deletion BEFORE DELETE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.queue_comment_sheet_deletion();

CREATE OR REPLACE FUNCTION public.suppress_deleted_sheet_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.sheet_reply_deletions d WHERE d.record_id=NEW.record_id
  AND btrim(d.expected_content)=btrim(NEW.content) AND (d.reply_index IS NULL OR d.reply_index=NEW.reply_index)) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.suppress_deleted_sheet_reply() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS suppress_deleted_sheet_reply ON public.sheet_record_replies;
CREATE TRIGGER suppress_deleted_sheet_reply BEFORE INSERT OR UPDATE ON public.sheet_record_replies
 FOR EACH ROW EXECUTE FUNCTION public.suppress_deleted_sheet_reply();

CREATE OR REPLACE FUNCTION public.delete_comment_with_sheet(p_id uuid,p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.comments%ROWTYPE; s public.sheet_record_replies%ROWTYPE; member_sheet text; existing public.sheet_reply_deletions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_kind NOT IN ('app','sheet') OR p_kind IS NULL THEN RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.sheet_reply_deletions WHERE id=p_id;
 IF FOUND THEN
  IF existing.actor_id IS DISTINCT FROM auth.uid() AND NOT public.can_moderate_comments() THEN RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501'; END IF;
  RETURN existing.id;
 END IF;
 IF p_kind='app' THEN
  SELECT * INTO c FROM public.comments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.user_id<>auth.uid() AND NOT public.can_moderate_comments() THEN RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501'; END IF;
  DELETE FROM public.comments WHERE id=p_id;
 ELSE
  IF NOT public.can_moderate_comments() THEN RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.sheet_record_replies WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT sheet_name INTO member_sheet FROM public.profiles WHERE id=s.owner_id;
  IF member_sheet IS NULL THEN RAISE EXCEPTION 'sheet_not_linked'; END IF;
  INSERT INTO public.sheet_reply_deletions(id,kind,actor_id,record_id,sheet_name,recorded_date,reply_index,expected_content)
  VALUES(s.id,'sheet',auth.uid(),s.record_id,member_sheet,s.recorded_date,s.reply_index,s.content);
  DELETE FROM public.sheet_record_replies WHERE id=p_id;
 END IF;
 RETURN (SELECT id FROM public.sheet_reply_deletions WHERE id=p_id);
END $$;
REVOKE ALL ON FUNCTION public.delete_comment_with_sheet(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_comment_with_sheet(uuid,text) TO authenticated;
