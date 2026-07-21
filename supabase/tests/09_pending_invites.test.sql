-- Pending invites: who may invite whom, owner invitations forbidden outright,
-- normalised emails, one live invite per (salon, email), immutable terms,
-- one-way outcomes. No email sending / Auth API here — data model only.
begin;
select plan(20);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com'),
  ('11111111-0000-0000-0000-000000000002', 'admin@example.com'),
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
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000002', 'admin'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'stylist');

-- ---------------------------------------------------------------------------
-- Acting as OWNER.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 1/2
select lives_ok(
  $$insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at)
    values ('eeeeeeee-0000-0000-0000-000000000001',
            'aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'admin',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  'an owner can invite an admin'
);
select lives_ok(
  $$insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at)
    values ('eeeeeeee-0000-0000-0000-000000000002',
            'aaaaaaaa-1111-1111-1111-111111111111', 'b@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  'an owner can invite a stylist'
);

-- ---------------------------------------------------------------------------
-- Acting as ADMIN.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 3
select lives_ok(
  $$insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at)
    values ('eeeeeeee-0000-0000-0000-000000000003',
            'aaaaaaaa-1111-1111-1111-111111111111', 'c@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000002', now() + interval '7 days')$$,
  'an admin can invite a stylist'
);
-- 4/5: role gating mirrors membership management.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'd@example.com', 'admin',
            '11111111-0000-0000-0000-000000000002', now() + interval '7 days')$$,
  '42501', null,
  'an admin cannot invite an admin'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'e@example.com', 'owner',
            '11111111-0000-0000-0000-000000000002', now() + interval '7 days')$$,
  '42501', null,
  'an admin cannot invite an owner'
);
-- 6: no inviting in someone else's name.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'f@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '42501', null,
  'the inviter must be the acting user'
);

-- ---------------------------------------------------------------------------
-- Acting as STYLIST: no invite powers, no visibility into invitee emails.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}', true);

-- 7/8
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'g@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000003', now() + interval '7 days')$$,
  '42501', null,
  'a stylist cannot invite anyone'
);
select is_empty(
  'select id from public.pending_invites',
  'a stylist cannot read invites (they hold third-party emails)'
);

-- ---------------------------------------------------------------------------
-- DB-level guarantees, exercised as postgres (bind privileged paths too).
-- ---------------------------------------------------------------------------
set local role postgres;

-- 9: the owner ban is a CHECK, not merely a policy branch.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'h@example.com', 'owner',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23514', null,
  'owner invitations are rejected by the schema itself'
);
-- 10/11: email normalisation is enforced, not hoped for.
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
-- 12: one live invite per (salon, email).
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '23505', null,
  'a second live invite for the same salon+email is rejected'
);

-- ---------------------------------------------------------------------------
-- Revocation and re-invitation, as the owner (the RLS path managers use).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 13/14
select lives_ok(
  $$update public.pending_invites set revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'a manager can revoke a live invite'
);
select lives_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'a@example.com', 'admin',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  'after revocation, the same email can be invited again'
);
-- 15/16: managers cannot rewrite terms, and outcomes are one-way.
-- Since the revoke-only column grant (20260718110000), a manager updating any
-- column but revoked_at is refused at the PRIVILEGE level (42501) — stronger
-- than, and ahead of, the immutability trigger. The trigger's own 23001 for
-- privileged paths is exercised in 11_invite_membership_hardening.
select throws_ok(
  $$update public.pending_invites set email = 'changed@example.com'
    where id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  '42501', null,
  'a manager cannot rewrite invite terms (no column privilege)'
);
select throws_ok(
  $$update public.pending_invites set revoked_at = null
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23001', null,
  'a revocation cannot be undone'
);

-- ---------------------------------------------------------------------------
-- Acceptance (simulating the future sb_secret_ server path) and its finality.
-- ---------------------------------------------------------------------------
set local role postgres;

-- 17/18/19
select lives_ok(
  $$update public.pending_invites
    set accepted_at = now(),
        accepted_profile_id = '11111111-0000-0000-0000-000000000004'
    where id = 'eeeeeeee-0000-0000-0000-000000000003'$$,
  'the service path can mark an invite accepted'
);
select throws_ok(
  $$update public.pending_invites set revoked_at = now()
    where id = 'eeeeeeee-0000-0000-0000-000000000003'$$,
  '23514', null,
  'an accepted invite cannot also be revoked (one outcome)'
);
select throws_ok(
  $$update public.pending_invites
    set accepted_profile_id = '11111111-0000-0000-0000-000000000001'
    where id = 'eeeeeeee-0000-0000-0000-000000000003'$$,
  '23001', null,
  'an acceptance cannot be rewritten to a different profile'
);

-- 20: an invite cannot be born expired.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'z@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() - interval '1 hour')$$,
  '23514', null,
  'expiry must lie after creation'
);

select * from finish();
rollback;
