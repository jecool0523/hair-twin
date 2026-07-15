-- Supabase environment shim for the offline verifier.
--
-- A real Supabase database already provides these: the auth/storage schemas,
-- the anon/authenticated/service_role roles, and auth.uid(). PGlite is plain
-- Postgres, so we recreate JUST enough of that contract to run the real
-- migrations and the real pgTAP tests against it.
--
-- This file is NOT a migration and is never applied to a Supabase project.
-- If it drifts from real Supabase, the tests stop being meaningful — keep it
-- minimal and boring.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- Supabase's stock roles.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
-- service_role bypasses RLS in Supabase; that is the whole point of it.
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth.users: only the columns this schema actually references.
create table auth.users (
  id uuid primary key,
  email text
);

-- auth.uid() reads the request's JWT claims, exactly like Supabase's.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- storage.buckets / storage.objects: the shape the storage migration touches.
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- Real Supabase grants storage.objects to anon AND authenticated and relies on
-- RLS policies to decide access (that is how public buckets serve anon). The
-- shim must match, otherwise "anon sees nothing" would pass here for the wrong
-- reason (missing grant) and still leak on a real project.
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant all on storage.objects, storage.buckets to service_role;
