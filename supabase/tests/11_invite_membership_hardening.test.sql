-- Hardening: pending_invites expiry as a terminal state (re-invite after lapse),
-- manager revoke-only column privilege, atomic reinvite, and salon_memberships
-- identity immutability. Pins the two reproduced defects.
begin;
select plan(22);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com'),
  ('11111111-0000-0000-0000-000000000002', 'admin@example.com'),
  ('11111111-0000-0000-0000-000000000003', 'stylist@example.com'),
  ('11111111-0000-0000-0000-000000000004', 'newcomer@example.com');
insert into public.profiles (id, display_name)
select id, email from auth.users;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');
insert into public.salon_memberships (id, salon_id, profile_id, role) values
  ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('99999999-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000002', 'admin'),
  ('99999999-0000-0000-0000-000000000003', 'aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'stylist');

-- ---------------------------------------------------------------------------
-- A. Re-invite after time-expiry — the reproduced defect.
-- ---------------------------------------------------------------------------
-- A lapsed but un-reaped invite (expires_at in the past, expired_at still null).
insert into public.pending_invites
  (id, salon_id, email, role, invited_by, created_at, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'a@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '10 days', now() - interval '3 days');

-- Before reaping, it still occupies the live slot (a still-live duplicate is
-- rejected — the index has not gone slack).
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23505', null,
  'a lapsed-but-unreaped invite still blocks a duplicate (index intact)'
);

-- Reap it (materialise expiry), and the slot frees — the defect is fixed.
update public.pending_invites set expired_at = now()
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  'once expired_at is set, the same email can be invited again'
);

-- ---------------------------------------------------------------------------
-- Terminal-state exclusivity + accepted pair.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.pending_invites
      set accepted_at = now(), accepted_profile_id = '11111111-0000-0000-0000-000000000004',
          revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23514', null,
  'an invite cannot be both accepted and revoked'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at, revoked_at, expired_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'x@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days', now(), now())$$,
  '23514', null,
  'an invite cannot be both revoked and expired'
);
-- A FRESH row (no other terminal state) so only the accepted-pair check can
-- reject it — otherwise the one-outcome check would shadow this and the test
-- would pass even against a one-directional pair check.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at, accepted_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'w@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days', now())$$,
  '23514', null,
  'accepted_at without accepted_profile_id is rejected (all-or-nothing)'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at, accepted_profile_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'y@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days',
            '11111111-0000-0000-0000-000000000004')$$,
  '23514', null,
  'accepted_profile_id without accepted_at is rejected (all-or-nothing)'
);

-- Expiry is one-way.
select throws_ok(
  $$update public.pending_invites set expired_at = null
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'an expiry cannot be undone'
);

-- The immutability trigger still guards terms for the PRIVILEGED path (managers
-- are stopped earlier by the column grant; service_role reaches the trigger).
select throws_ok(
  $$update public.pending_invites set email = 'rewritten@example.com'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'invite terms are immutable even to the service path (trigger)'
);

-- ---------------------------------------------------------------------------
-- Manager privilege: revoke ONLY (column-level grant + RLS).
-- ---------------------------------------------------------------------------
-- A fresh live invite to act on.
insert into public.pending_invites
  (id, salon_id, email, role, invited_by, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111',
   'c@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$update public.pending_invites set expired_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  '42501', null,
  'a manager cannot set expired_at (no column privilege)'
);
select throws_ok(
  $$update public.pending_invites
      set accepted_at = now(), accepted_profile_id = '11111111-0000-0000-0000-000000000004'
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  '42501', null,
  'a manager cannot mark an invite accepted'
);
select lives_ok(
  $$update public.pending_invites set revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  'a manager can revoke'
);

-- ---------------------------------------------------------------------------
-- Atomic reinvite_to_salon: reap the lapsed one + seat a fresh one, authorised
-- from the membership table only.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.pending_invites
  (id, salon_id, email, role, invited_by, created_at, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-1111-1111-1111-111111111111',
   'd@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '9 days', now() - interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

select isnt(
  public.reinvite_to_salon('aaaaaaaa-1111-1111-1111-111111111111', 'd@example.com',
    'stylist'::public.membership_role, now() + interval '7 days'),
  null,
  'an owner can atomically reap a lapsed invite and re-invite'
);
select is(
  (select count(*)::int from public.pending_invites
   where email = 'd@example.com' and expired_at is not null),
  1,
  'the lapsed invite was reaped (expired_at set)'
);
select is(
  (select count(*)::int from public.pending_invites
   where email = 'd@example.com'
     and accepted_at is null and revoked_at is null and expired_at is null),
  1,
  'exactly one fresh live invite exists afterwards'
);

-- A still-VALID live invite is not reaped, so reinvite collides rather than
-- silently overwriting an outstanding invitation.
select throws_ok(
  $$select public.reinvite_to_salon('aaaaaaaa-1111-1111-1111-111111111111',
      'd@example.com', 'stylist'::public.membership_role, now() + interval '7 days')$$,
  '23505', null,
  'reinvite does not overwrite a still-valid outstanding invite'
);

-- Authorisation is from membership, and owner cannot be invited.
select throws_ok(
  $$select public.reinvite_to_salon('aaaaaaaa-1111-1111-1111-111111111111',
      'z@example.com', 'owner'::public.membership_role, now() + interval '7 days')$$,
  '23514', null,
  'reinvite refuses to grant owner'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.reinvite_to_salon('aaaaaaaa-1111-1111-1111-111111111111',
      'e@example.com', 'stylist'::public.membership_role, now() + interval '7 days')$$,
  '42501', null,
  'a stylist cannot reinvite anyone'
);

-- ---------------------------------------------------------------------------
-- B. salon_memberships identity immutability — even as postgres (service path).
-- ---------------------------------------------------------------------------
set local role postgres;

select throws_ok(
  $$update public.salon_memberships
      set profile_id = '11111111-0000-0000-0000-000000000004'
    where id = '99999999-0000-0000-0000-000000000003'$$,
  '23001', null,
  'a membership cannot be re-pointed to a different profile'
);
select throws_ok(
  $$update public.salon_memberships
      set salon_id = 'bbbbbbbb-1111-1111-1111-111111111111'
    where id = '99999999-0000-0000-0000-000000000003'$$,
  '23001', null,
  'a membership cannot be moved to a different salon'
);
select throws_ok(
  $$update public.salon_memberships
      set id = '99999999-0000-0000-0000-00000000000f'
    where id = '99999999-0000-0000-0000-000000000003'$$,
  '23001', null,
  'a membership id cannot be rewritten'
);
select throws_ok(
  $$update public.salon_memberships set created_at = now() - interval '1 year'
    where id = '99999999-0000-0000-0000-000000000003'$$,
  '23001', null,
  'a membership created_at cannot be back-dated'
);
select lives_ok(
  $$update public.salon_memberships set role = 'admin'
    where id = '99999999-0000-0000-0000-000000000003'$$,
  'the role can still be changed (the one mutable field)'
);

select * from finish();
rollback;
