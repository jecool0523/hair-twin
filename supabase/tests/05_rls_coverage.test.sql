-- Guard rail: every exposed table must have RLS enabled and at least one
-- policy. This fails loudly the day someone adds a table and forgets — which
-- is exactly how customer face data leaks.
begin;
select plan(3);

-- Every table in the API-exposed schema has RLS enabled.
select is_empty(
  $$select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity$$,
  'every table in public has row level security enabled'
);

-- Every RLS-enabled table actually has policies (RLS with no policy denies all,
-- which is safe but usually means the policies were forgotten).
select is_empty(
  $$select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not exists (
        select 1 from pg_policy p where p.polrelid = c.oid
      )$$,
  'every RLS-enabled table in public has at least one policy'
);

-- anon must hold no privileges on customer data.
select is_empty(
  $$select table_name::text
    from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'$$,
  'anon has no table privileges in public'
);

select * from finish();
rollback;
