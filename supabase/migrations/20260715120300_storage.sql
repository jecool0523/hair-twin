-- Hair Twin — private storage buckets and object policies.
--
-- Every bucket is PRIVATE (public = false). There is no public object URL:
-- the app hands the browser short-lived signed URLs generated server-side.
--
-- Path convention (enforced by the policies below):
--     <salon_id>/<session_id>/<filename>
-- The first path segment is the tenant key, so object access can be authorised
-- with the same membership check used by the tables.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-images-private',    'source-images-private',    false, 10485760,
     array['image/png','image/jpeg','image/webp']),
  ('generated-assets-private', 'generated-assets-private', false, 10485760,
     array['image/png','image/jpeg','image/webp']),
  -- Masks are part of the AI contract and are as sensitive as the source photo:
  -- they describe the customer's hairline and face region.
  ('masks-private',            'masks-private',            false, 10485760,
     array['image/png']),
  ('reports-private',          'reports-private',          false, 20971520,
     array['application/pdf','image/png','application/json']),
  -- Salon-owned reference imagery (not customer faces).
  ('style-reference-assets',   'style-reference-assets',   false, 10485760,
     array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Object policies: the first folder segment must be a salon the user belongs to.
-- ---------------------------------------------------------------------------

-- Helper: first path segment as a salon uuid, or NULL when the path is not
-- shaped like <salon_id>/... (which then fails the membership check).
create or replace function private.storage_salon_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_segment text;
begin
  first_segment := split_part(object_name, '/', 1);
  begin
    return first_segment::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

grant execute on function private.storage_salon_id(text) to authenticated;

do $$
declare
  b text;
  buckets text[] := array[
    'source-images-private',
    'generated-assets-private',
    'masks-private',
    'reports-private',
    'style-reference-assets'
  ];
begin
  foreach b in array buckets loop
    -- SELECT (read/download)
    execute format($f$
      create policy %I on storage.objects
        for select to authenticated
        using (
          bucket_id = %L
          and private.is_salon_member(private.storage_salon_id(name))
        );
    $f$, b || '_select', b);

    -- INSERT (upload)
    execute format($f$
      create policy %I on storage.objects
        for insert to authenticated
        with check (
          bucket_id = %L
          and private.is_salon_member(private.storage_salon_id(name))
        );
    $f$, b || '_insert', b);

    -- UPDATE (replace)
    execute format($f$
      create policy %I on storage.objects
        for update to authenticated
        using (
          bucket_id = %L
          and private.is_salon_member(private.storage_salon_id(name))
        )
        with check (
          bucket_id = %L
          and private.is_salon_member(private.storage_salon_id(name))
        );
    $f$, b || '_update', b, b);

    -- DELETE (privacy erasure must stay available to any member)
    execute format($f$
      create policy %I on storage.objects
        for delete to authenticated
        using (
          bucket_id = %L
          and private.is_salon_member(private.storage_salon_id(name))
        );
    $f$, b || '_delete', b);
  end loop;
end;
$$;

-- NOTE: service_role bypasses these policies and is what the Python AI worker
-- uses to read source images + masks and write generated assets. That key must
-- never reach the browser.
