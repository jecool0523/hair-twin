-- Private storage buckets (system-design §5 storage buckets).
-- All buckets are PRIVATE (public = false). Access is via short-lived signed
-- URLs generated server-side. There are no public object URLs.
--
-- Not yet applied — see ADR-0003.

insert into storage.buckets (id, name, public)
values
  ('source-images-private',    'source-images-private',    false),
  ('generated-assets-private', 'generated-assets-private', false),
  ('reports-private',          'reports-private',          false),
  ('style-reference-assets',   'style-reference-assets',   false)
on conflict (id) do nothing;

-- Object access is mediated by the server/worker using the service role, which
-- bypasses RLS. If direct authenticated client reads are ever enabled, add
-- salon-scoped policies on storage.objects keyed by the path prefix. Until then
-- the browser only receives signed URLs, never bucket credentials.
