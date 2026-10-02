-- System-only trial of meet operations. Existing registrations and duties are not rewritten.
CREATE TABLE IF NOT EXISTS public.ob_event_operations (
  meet_key text NOT NULL DEFAULT 'ob-2026' CHECK (meet_key='ob-2026'),
  event_name text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meet_key,event_name)
);
CREATE TABLE IF NOT EXISTS public.ob_operation_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_key text NOT NULL,
  event_name text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_data jsonb,
  after_data jsonb NOT NULL
);
ALTER TABLE public.ob_event_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ob_operation_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_event_operations, public.ob_operation_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ob_event_operations, public.ob_operation_changes TO authenticated;
GRANT ALL ON public.ob_event_operations, public.ob_operation_changes TO service_role;
DROP POLICY IF EXISTS ob_operations_system_read ON public.ob_event_operations;
CREATE POLICY ob_operations_system_read ON public.ob_event_operations FOR SELECT TO authenticated USING (public.can_manage_system());
DROP POLICY IF EXISTS ob_operation_changes_system_read ON public.ob_operation_changes;
CREATE POLICY ob_operation_changes_system_read ON public.ob_operation_changes FOR SELECT TO authenticated USING (public.can_manage_system());
-- A system-only custom role may inspect the roster without acquiring entry/duty editing privileges.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ob_meet_entries','ob_party_responses','ob_meet_duties','ob_duty_roles'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS ob_operations_roster_read ON public.%I',t);
    EXECUTE format('CREATE POLICY ob_operations_roster_read ON public.%I FOR SELECT TO authenticated USING (public.can_manage_system())',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_ob_event_operation(p_event text,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  target public.ob_event_operations%ROWTYPE; saved public.ob_event_operations%ROWTYPE;
  p jsonb; t jsonb; entry public.ob_meet_entries%ROWTYPE;
  ids text[]:='{}'; places text[]:='{}'; position_key text; base text;
  track boolean; height boolean; wind_allowed boolean; confirmed boolean;
  mark text; wind text; state text; parts text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
  IF p_event IS NULL OR p_event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
    OR p_revision<0 OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>250000
    OR jsonb_typeof(p_data->'participants') IS DISTINCT FROM 'array' OR jsonb_typeof(p_data->'confirmed') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  IF jsonb_array_length(p_data->'participants')>300 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('participants','confirmed')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  -- Serialize initial inserts as well as updates; the expected revision prevents lost updates.
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||p_event,0));
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
  IF (FOUND AND p_revision IS DISTINCT FROM target.revision) OR (NOT FOUND AND p_revision IS NOT NULL) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  base:=substring(p_event FROM 3); track:=base IN ('100m','300m','300mH','1500m','3000m'); height:=base='走り高跳び'; wind_allowed:=base IN ('100m','走り幅跳び'); confirmed:=(p_data->>'confirmed')::boolean;
  -- Lock registrations consulted below so entry edits cannot race validation.
  PERFORM 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' ORDER BY id FOR SHARE;
  FOR p IN SELECT value FROM jsonb_array_elements(p_data->'participants') LOOP
    IF jsonb_typeof(p)<>'object' OR jsonb_typeof(p->'entryId') IS DISTINCT FROM 'string'
      OR (p->>'entryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR p->>'entryId'<>lower(p->>'entryId') OR p->>'entryId'=ANY(ids) OR p->>'status' IS NULL OR p->>'status' NOT IN ('entered','DNS','DNF','DQ')
      OR jsonb_typeof(p->'trials') IS DISTINCT FROM 'array'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('entryId','group','order','status','trials')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    ids:=array_append(ids,p->>'entryId');
    SELECT * INTO entry FROM public.ob_meet_entries WHERE id=(p->>'entryId')::uuid AND meet_key='ob-2026';
    IF NOT FOUND OR (NOT p_event=ANY(entry.events) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')) THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF confirmed AND NOT p_event=ANY(entry.events) AND p->>'status'<>'DNS' THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT (p ? 'group' AND p ? 'order') OR EXISTS(SELECT 1 FROM (VALUES(p->'group'),(p->'order')) v(n) WHERE n<>'null'::jsonb AND (jsonb_typeof(n)<>'number' OR (n#>>'{}') !~ '^[1-9][0-9]?$')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    IF p->>'group' IS NOT NULL AND p->>'order' IS NOT NULL AND p->>'status'<>'DNS' THEN
      position_key:=(p->>'group')||':'||(p->>'order');
      IF position_key=ANY(places) THEN RAISE EXCEPTION 'operation_position'; END IF;
      places:=array_append(places,position_key);
    END IF;
    IF jsonb_array_length(p->'trials')>(CASE WHEN track THEN 1 WHEN height THEN 30 ELSE 6 END) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    FOR t IN SELECT value FROM jsonb_array_elements(p->'trials') LOOP
      IF jsonb_typeof(t)<>'object' OR jsonb_typeof(t->'mark') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'wind') IS DISTINCT FROM 'string'
        OR t->>'status' IS NULL OR t->>'status' NOT IN ('pending','valid','foul','pass')
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(t) k WHERE k NOT IN ('mark','wind','status')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
      mark:=t->>'mark'; wind:=t->>'wind'; state:=t->>'status';
      IF track AND state NOT IN ('pending','valid') THEN RAISE EXCEPTION 'operation_mark'; END IF;
      IF length(mark)>20 OR length(wind)>8 OR (state='pending' AND (mark<>'' OR wind<>''))
        OR (state='valid' AND mark='') OR (height AND state<>'pending' AND mark='')
        OR (NOT height AND state NOT IN ('pending','valid') AND mark<>'') THEN RAISE EXCEPTION 'operation_mark'; END IF;
      IF mark<>'' THEN
        IF track THEN
          IF mark !~ '^[0-9]{1,3}(:[0-9]{1,2}){0,2}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'operation_mark'; END IF;
          parts:=string_to_array(mark,':');
          IF EXISTS(SELECT 1 FROM unnest(parts) WITH ORDINALITY a(n,i) WHERE i>1 AND n::numeric>=60) OR NOT EXISTS(SELECT 1 FROM unnest(parts) a(n) WHERE n::numeric>0) THEN RAISE EXCEPTION 'operation_mark'; END IF;
        ELSIF mark !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR mark::numeric<=0 THEN RAISE EXCEPTION 'operation_mark';
        END IF;
      END IF;
      IF wind<>'' AND (state<>'valid' OR NOT wind_allowed OR wind !~ '^[+-]?[0-9]{1,2}(\.[0-9])?$') THEN RAISE EXCEPTION 'operation_wind'; END IF;
    END LOOP;
    IF confirmed AND p->>'status'='entered' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'trials') a WHERE a->>'status' IN ('valid','foul')) THEN RAISE EXCEPTION 'operation_incomplete'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.ob_meet_entries e WHERE meet_key='ob-2026' AND p_event=ANY(e.events) AND NOT e.id::text=ANY(ids))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE NOT (old->>'entryId')=ANY(ids)) THEN RAISE EXCEPTION 'operation_roster'; END IF;
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data,updated_at) VALUES('ob-2026',p_event,coalesce(target.revision+1,0),p_data,now())
    ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at RETURNING * INTO saved;
  INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',p_event,auth.uid(),target.data,p_data);
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) TO authenticated;
DROP TRIGGER IF EXISTS zz_log_failover_change ON public.ob_event_operations;
CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.ob_event_operations FOR EACH ROW EXECUTE FUNCTION public.log_failover_change('meet_key','event_name');
DROP TRIGGER IF EXISTS zz_log_failover_change ON public.ob_operation_changes;
CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.ob_operation_changes FOR EACH ROW EXECUTE FUNCTION public.log_failover_change('id');
NOTIFY pgrst, 'reload schema';
