-- Hardening: pending_invites expiry as a terminal state (re-invite after lapse),
-- terminal-state exclusivity + all-or-nothing acceptance, one-way expiry, and
-- salon_memberships identity immutability. All exercised on the privileged
-- (service) path — the client-facing RPC surface lives in 12_invite_rpc.
begin;
select plan(13);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com'),
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
  ('99999999-0000-0000-0000-000000000003', 'aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'stylist');

-- ---------------------------------------------------------------------------
-- A. Re-invite after time-expiry — the reproduced defect. A lapsed but un-reaped
-- invite (expires_at in the past, expired_at still null) still holds the slot.
-- ---------------------------------------------------------------------------
insert into public.pending_invites
  (id, salon_id, email, role, invited_by, created_at, expires_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'a@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '10 days', now() - interval '3 days');

select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23505', null,
  'a lapsed-but-unreaped invite still blocks a duplicate (index intact)'
);
update public.pending_invites set expired_at = now()
  where id = 'eeeeeeee-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  'once expired_at is set, the same email can be invited again'
);

-- ---------------------------------------------------------------------------
-- Terminal-state exclusivity + accepted pair. FRESH rows so exactly the check
-- under test can reject each one (no other terminal state shadowing it), and all
-- timestamps sit within [created_at, expires_at] so the temporal checks pass and
-- only the intended structural check fires.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.pending_invites
      (salon_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_profile_id, revoked_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'ar@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() - interval '1 day', now(),
            now(), '11111111-0000-0000-0000-000000000004', now())$$,
  '23514', null,
  'an invite cannot be both accepted and revoked'
);
select throws_ok(
  $$insert into public.pending_invites
      (salon_id, email, role, invited_by, created_at, expires_at, revoked_at, expired_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 're@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() - interval '1 day', now(),
            now(), now())$$,
  '23514', null,
  'an invite cannot be both revoked and expired'
);
select throws_ok(
  $$insert into public.pending_invites
      (salon_id, email, role, invited_by, created_at, expires_at, accepted_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'w@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() - interval '1 day', now(), now())$$,
  '23514', null,
  'accepted_at without accepted_profile_id is rejected (all-or-nothing)'
);
select throws_ok(
  $$insert into public.pending_invites
      (salon_id, email, role, invited_by, expires_at, accepted_profile_id)
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
-- The immutability trigger still guards terms for the privileged path.
select throws_ok(
  $$update public.pending_invites set email = 'rewritten@example.com'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'invite terms are immutable even to the service path (trigger)'
);

-- ---------------------------------------------------------------------------
-- B. salon_memberships identity immutability — even as postgres (service path).
-- ---------------------------------------------------------------------------
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
