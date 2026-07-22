-- Consent records are immutable except revocation, and can never be deleted.
begin;
select plan(11);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'stylist@example.com');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Stylist');
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A');
insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'stylist');

insert into public.consent_records
  (id, salon_id, capture_consented, save_images_consented, wording_version)
values
  ('cccccccc-1111-1111-1111-111111111111',
   'aaaaaaaa-1111-1111-1111-111111111111', true, false, 'draft-ko-2026-07');

-- ---------------------------------------------------------------------------
-- Schema-level guarantees.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.consent_records (salon_id, capture_consented, wording_version)
    values ('aaaaaaaa-1111-1111-1111-111111111111', false, 'draft')$$,
  '23514',
  null,
  'consent without capture_consented is rejected by a check constraint'
);

select throws_ok(
  $$insert into public.consent_records (salon_id, capture_consented, wording_version, revoked_reason)
    values ('aaaaaaaa-1111-1111-1111-111111111111', true, 'draft', 'why')$$,
  '23514',
  null,
  'a revocation reason without a revocation timestamp is rejected'
);

-- ---------------------------------------------------------------------------
-- Immutability applies even to the table owner / service_role, because it is a
-- trigger rather than a policy. This is the point: privacy invariants must not
-- depend on which key happens to be in play.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.consent_records
    set save_images_consented = true
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'flipping save_images_consented after the fact is blocked'
);

select throws_ok(
  $$update public.consent_records
    set wording_version = 'rewritten'
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'rewriting which consent text the customer saw is blocked'
);

select throws_ok(
  $$update public.consent_records
    set consented_at = now() - interval '1 year'
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'back-dating consent is blocked'
);

select throws_ok(
  $$delete from public.consent_records
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'consent records cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Revocation: allowed once, and one-way.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.consent_records
    set revoked_at = now(), revoked_reason = '고객 요청'
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  'revocation is allowed'
);

select isnt(
  (select revoked_at from public.consent_records
   where id = 'cccccccc-1111-1111-1111-111111111111'),
  null,
  'revocation is recorded'
);

select throws_ok(
  $$update public.consent_records
    set revoked_at = null
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'un-revoking consent is blocked'
);

select throws_ok(
  $$update public.consent_records
    set revoked_at = now() + interval '1 day'
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '23001',
  null,
  'rewriting an existing revocation timestamp is blocked'
);

-- ---------------------------------------------------------------------------
-- A member has no DELETE privilege on consent at all (no grant, no policy).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select throws_ok(
  $$delete from public.consent_records
    where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'a stylist has no delete privilege on consent records'
);

select * from finish();
rollback;
