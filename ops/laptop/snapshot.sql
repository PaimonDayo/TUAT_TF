\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT format(
  'SELECT jsonb_build_object(''schema'',%L,''name'',%L,''columns'',%L::jsonb,''pk'',%L::jsonb,''foreignKeys'',%L::jsonb,''rows'',coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb)) FROM %I.%I t;',
  n.nspname,c.relname,
  (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  coalesce((SELECT jsonb_agg(a.attname ORDER BY u.ord) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.num WHERE i.indrelid=c.oid AND i.indisprimary),'[]'::jsonb),
  coalesce((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f'),'[]'::jsonb),
  n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND (n.nspname='public' OR (n.nspname='auth' AND c.relname IN ('users','identities')))
ORDER BY n.nspname,c.relname
\gexec
COMMIT;
