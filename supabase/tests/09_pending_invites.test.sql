-- Pending invites — SCHEMA invariants, exercised on the privileged (service)
-- path. Since 20260721100000 the client cannot write pending_invites directly at
-- all (every mutation goes through the RPCs, covered in 12_invite_rpc); this file
-- pins the guarantees that hold regardless of who writes: CHECK constraints,
-- normalised email, one live invite per (salon,email), immutable terms, one-way
-- outcomes, acceptance finality. The one authenticated assertion here is the read
-- side (a stylist must not see invitee emails).
begin;
select plan(12);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com'),
  ('11111111-0000-0000-0000-000000000003', 'stylist@example.com'),
  ('11111111-0000-0000-0000-000000000004', 'newcomer@example.com');
insert into public.profiles (id, display_name)
select id, email from auth.users;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A');
insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'stylist');

-- 1: the owner ban is a CHECK, not merely a policy branch.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'h@example.com', 'owner',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23514', null,
  'owner invitations are rejected by the schema itself'
);
-- 2/3: email normalisation is enforced by CHECK, not hoped for.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'Upper@Example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23514', null,
  'a non-normalised email is rejected'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'not-an-email', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23514', null,
  'a string without @ is rejected'
);
-- 4: an invite cannot be born already past its deadline.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'z@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() - interval '1 hour')$$,
  '23514', null,
  'expiry must lie after creation'
);

-- A live invite to build the remaining invariants on.
insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at)
values ('eeeeeeee-0000-0000-0000-000000000001',
        'aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
        '11111111-0000-0000-0000-000000000001', now() + interval '7 days');

-- 5: one live invite per (salon, email).
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'admin',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23505', null,
  'a second live invite for the same salon+email is rejected'
);
-- 6: terms are immutable even to the service path (trigger).
select throws_ok(
  $$update public.pending_invites set email = 'changed@example.com'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'invite terms are immutable even on the privileged path'
);

-- 7/8: acceptance (the future sb_secret_ server path) and its finality.
select lives_ok(
  $$update public.pending_invites
      set accepted_at = now(),
          accepted_profile_id = '11111111-0000-0000-0000-000000000004'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'the service path can mark an invite accepted'
);
select throws_ok(
  $$update public.pending_invites set revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23514', null,
  'an accepted invite cannot also be revoked (one outcome)'
);
-- 9: an acceptance cannot be rewritten to a different profile.
select throws_ok(
  $$update public.pending_invites
      set accepted_profile_id = '11111111-0000-0000-0000-000000000001'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'an acceptance cannot be rewritten to a different profile'
);

-- 10/11: revocation is one-way (on a fresh live invite).
insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at)
values ('eeeeeeee-0000-0000-0000-000000000002',
        'aaaaaaaa-1111-1111-1111-111111111111', 'b@example.com', 'stylist',
        '11111111-0000-0000-0000-000000000001', now() + interval '7 days');
select lives_ok(
  $$update public.pending_invites set revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  'the service path can revoke a live invite'
);
select throws_ok(
  $$update public.pending_invites set revoked_at = null
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  '23001', null,
  'a revocation cannot be undone'
);

-- 12: a stylist cannot read invites (they hold third-party emails). SELECT RLS
-- still applies to authenticated even though writes are now RPC-only.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty(
  'select id from public.pending_invites',
  'a stylist cannot read invites (they hold third-party emails)'
);

select * from finish();
rollback;
