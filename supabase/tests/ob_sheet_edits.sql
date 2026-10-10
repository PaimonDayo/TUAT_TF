-- Execute inside BEGIN/ROLLBACK against the real schema. Only synthetic identities are examined.
DO $$
DECLARE context jsonb; changes jsonb; answer jsonb; prior jsonb; before_hash text; after_hash text;
 test_id uuid:='00000000-0000-4000-8000-000000001301'; req uuid:='00000000-0000-4000-8000-000000001302'; rev integer;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.ob_meet_entries(id,meet_key,submitted_name,grade,events) VALUES(test_id,'ob-2026','架空Sheet試験1301','B1',ARRAY['男子100m']);
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision)),'operations','[]'::jsonb) INTO context FROM public.ob_meet_entries e WHERE meet_key='ob-2026';
 SELECT revision INTO rev FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name='男子300m';
 -- Clear confirmation only within this rollback rehearsal; no source participants are removed.
 UPDATE public.ob_event_operations SET data=jsonb_set(data,'{confirmed}','false') WHERE meet_key='ob-2026' AND event_name IN ('男子100m','男子300m');
 changes:=jsonb_build_array(jsonb_build_object('entryId',test_id,'entryRevision',0,'event','男子300m','operationRevision',rev,'status','entered','position',true,'group',99,'order',599,'heatScope','混合','newKey',NULL,'name',NULL,'grade',NULL));
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.ob_meet_entries t),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY event_name) FROM public.ob_event_operations t),(SELECT count(*) FROM public.ob_operation_changes),(SELECT count(*) FROM public.ob_entry_changes))::text) INTO before_hash;
 answer:=public.apply_ob_sheet_edits(req,context,changes,true);
 IF NOT (answer->>'dryRun')::boolean THEN RAISE EXCEPTION 'dryrun failed'; END IF;
 SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.ob_meet_entries t),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY event_name) FROM public.ob_event_operations t),(SELECT count(*) FROM public.ob_operation_changes),(SELECT count(*) FROM public.ob_entry_changes))::text) INTO after_hash;
 IF before_hash<>after_hash THEN RAISE EXCEPTION 'dryrun changed data'; END IF;
 answer:=public.apply_ob_sheet_edits(req,context,changes,false);
 prior:=public.apply_ob_sheet_edits(req,context,changes,false);
 IF answer<>prior OR (SELECT count(*) FROM public.ob_operation_changes WHERE request_id=req)<>1 THEN RAISE EXCEPTION 'duplicate save'; END IF;
 IF NOT (SELECT '男子300m'=ANY(events) FROM public.ob_meet_entries WHERE ob_meet_entries.id=test_id) THEN RAISE EXCEPTION 'event not added'; END IF;
 BEGIN PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false); RAISE EXCEPTION 'stale accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision)),'operations','[]'::jsonb) INTO context FROM public.ob_meet_entries e WHERE meet_key='ob-2026';
 SELECT revision INTO rev FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name='男子100m';
 changes:=jsonb_build_array(jsonb_build_object('entryId',NULL,'entryRevision',NULL,'event','男子100m','operationRevision',rev,'status','entered','position',true,'group',99,'order',598,'heatScope','混合','newKey','架空Sheet新規1303','name','架空Sheet新規1303','grade','OB・OG'));
 req:='00000000-0000-4000-8000-000000001303';
 PERFORM public.apply_ob_sheet_edits(req,context,changes,true);
 PERFORM public.apply_ob_sheet_edits(req,context,changes,false);
 PERFORM public.apply_ob_sheet_edits(req,context,changes,false);
 IF (SELECT count(*) FROM public.ob_meet_entries WHERE submitted_name='架空Sheet新規1303')<>1 THEN RAISE EXCEPTION 'new person duplicated'; END IF;
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision)),'operations','[]'::jsonb) INTO context FROM public.ob_meet_entries e WHERE meet_key='ob-2026';
 SELECT revision INTO rev FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name='男子100m';
 changes:=jsonb_set(changes,'{0,operationRevision}',to_jsonb(rev));
 BEGIN PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false); RAISE EXCEPTION 'duplicate name accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 -- Move the synthetic participant, preserving every trial, then reject a physical lane collision.
 changes:=jsonb_build_array(jsonb_build_object('entryId',test_id,'entryRevision',1,'event','男子100m','operationRevision',rev,'status','entered','position',true,'group',99,'order',598,'heatScope','混合','newKey',NULL,'name',NULL,'grade',NULL));
 BEGIN PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false); RAISE EXCEPTION 'lane collision accepted' USING ERRCODE='XX000'; EXCEPTION WHEN raise_exception THEN NULL; END;
 changes:=jsonb_set(changes,'{0,order}','597');
 PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false);
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision)),'operations','[]'::jsonb) INTO context FROM public.ob_meet_entries e WHERE meet_key='ob-2026';
 SELECT revision INTO rev FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name='男子100m';
 changes:=jsonb_set(jsonb_set(changes,'{0,entryRevision}','1'),'{0,operationRevision}',to_jsonb(rev));
 changes:=jsonb_set(changes,'{0,group}','98');
 PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false);
 IF NOT EXISTS(SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p WHERE o.event_name='男子100m' AND p->>'entryId'=test_id::text AND p->>'group'='98' AND p->>'order'='597' AND p->'trials'='[]') THEN RAISE EXCEPTION 'move failed'; END IF;
 IF has_function_privilege('anon','public.apply_ob_sheet_edits(uuid,jsonb,jsonb,boolean)','EXECUTE') OR has_function_privilege('authenticated','public.apply_ob_sheet_edits(uuid,jsonb,jsonb,boolean)','EXECUTE') THEN RAISE EXCEPTION 'public write allowed'; END IF;
END $$;
