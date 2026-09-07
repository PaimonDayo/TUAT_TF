-- The normal CLI schema dump excludes auth/storage, including application customizations.
SELECT format('DROP TRIGGER IF EXISTS %I ON %I.%I;', t.tgname, n.nspname, c.relname)
       || E'\n' || pg_get_triggerdef(t.oid) || ';'
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal AND n.nspname IN ('auth', 'storage') AND pn.nspname = 'public'
ORDER BY n.nspname, c.relname, t.tgname;

SELECT format('DROP POLICY IF EXISTS %I ON %I.%I;', policyname, schemaname, tablename)
       || E'\n' || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
          policyname, schemaname, tablename, permissive, cmd,
          (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r))
       || CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END
       || CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END || ';'
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;
