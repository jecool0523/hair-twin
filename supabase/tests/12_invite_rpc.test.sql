-- Invite RPC surface (20260721100000). Every invite mutation now flows through
-- two SECURITY DEFINER functions; the client holds NO direct write on
-- pending_invites. This file pins:
--   * the execute ACL (anon/service_role/PUBLIC denied, authenticated only),
--   * that authenticated cannot INSERT/UPDATE the table directly,
--   * the authorisation matrix (owner/admin/stylist/non-member),
--   * server-fixed fields the caller cannot influence (email normalisation,
--     exactly-7-day TTL, revoke time = server now()),
--   * atomic reap-and-reinvite after lapse, and collision on a still-live invite,
--   * the temporal CHECKs (accepted/revoked within life; expired ≥ deadline).
--
-- MUTATION TESTING NOTE: there is no automated mutation harness for SQL. The
-- protections here were mutation-verified BY HAND (see the completion report):
-- e.g. dropping the `revoke execute ... from public` line makes the anon-RPC
-- assertions fail; widening the TTL to a client argument breaks the 7-day
-- assertion; removing the has_salon_role guard breaks the stylist/non-member
-- cases. Re-run those by hand when this migration changes.
begin;
select plan(35);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com'),
  ('11111111-0000-0000-0000-000000000002', 'admin@example.com'),
  ('11111111-0000-0000-0000-000000000003', 'stylist@example.com'),
  ('11111111-0000-0000-0000-000000000004', 'newcomer@example.com'),
  ('11111111-0000-0000-0000-000000000005', 'outsider@example.com');
insert into public.profiles (id, display_name)
select id, email from auth.users;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');
insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000002', 'admin'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'stylist'),
  -- The outsider is a member of a DIFFERENT salon only (owner of B, nothing in A).
  ('bbbbbbbb-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000005', 'owner');

-- Seed rows the behaviour assertions act on (as postgres — the service path).
-- Explicit ids so the revoke assertions can name the invite by LITERAL: a
-- stylist / non-member cannot SELECT invites under RLS, so a subquery for the id
-- would resolve to NULL and mask the authorisation failure we mean to test.
insert into public.pending_invites (id, salon_id, email, role, invited_by, expires_at) values
  ('dddddddd-0000-0000-0000-000000000000', 'aaaaaaaa-1111-1111-1111-111111111111', 'probe@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() + interval '7 days'),
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111', 'd1@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() + interval '7 days'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111', 'd2@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() + interval '7 days');
-- An already-revoked invite (terminal), and a time-lapsed one.
insert into public.pending_invites (id, salon_id, email, role, invited_by, created_at, expires_at, revoked_at) values
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-1111-1111-1111-111111111111', 'd4@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() - interval '1 day', now() + interval '7 days', now());
insert into public.pending_invites (id, salon_id, email, role, invited_by, created_at, expires_at) values
  ('dddddddd-0000-0000-0000-000000000005', 'aaaaaaaa-1111-1111-1111-111111111111', 'd5@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() - interval '10 days', now() - interval '1 day');
-- A lapsed live invite to be atomically reaped + re-invited.
insert into public.pending_invites (salon_id, email, role, invited_by, created_at, expires_at) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'reinv@example.com', 'stylist',
   '11111111-0000-0000-0000-000000000001', now() - interval '9 days', now() - interval '1 day');

-- ===========================================================================
-- ACL / grants (introspection, as postgres).
-- ===========================================================================
-- No PUBLIC (grantee 0) execute entry remains on either function.
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.create_or_reinvite_salon_invite(uuid,text,public.membership_role)'::regprocedure
      and a.grantee = 0),
  0, 'no PUBLIC execute grant on create_or_reinvite_salon_invite'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.revoke_salon_invite(uuid)'::regprocedure
      and a.grantee = 0),
  0, 'no PUBLIC execute grant on revoke_salon_invite'
);
select ok(
  not has_function_privilege('service_role',
    'public.create_or_reinvite_salon_invite(uuid,text,public.membership_role)'::regprocedure, 'execute'),
  'service_role cannot execute the create RPC'
);
select ok(
  not has_function_privilege('service_role',
    'public.revoke_salon_invite(uuid)'::regprocedure, 'execute'),
  'service_role cannot execute the revoke RPC'
);
select ok(
  has_function_privilege('authenticated',
    'public.create_or_reinvite_salon_invite(uuid,text,public.membership_role)'::regprocedure, 'execute'),
  'authenticated may execute the create RPC'
);
-- The legacy client-TTL function is gone.
select is(
  (select count(*)::int from pg_proc
    where proname = 'reinvite_to_salon' and pronamespace = 'public'::regnamespace),
  0, 'the legacy reinvite_to_salon function is removed'
);
-- The create RPC takes no client-supplied timestamp — TTL is server-fixed.
select is(
  (select count(*)::int from pg_proc
    where proname = 'create_or_reinvite_salon_invite'
      and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) like '%timestamp%'),
  0, 'the create RPC has no timestamp argument (TTL is not caller-supplied)'
);

-- ===========================================================================
-- Temporal CHECKs exist (direct inserts on the service path).
-- ===========================================================================
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, created_at, expires_at, expired_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'f1@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now(), now() + interval '7 days', now())$$,
  '23514', null,
  'expired_at earlier than the deadline is rejected'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_profile_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'f2@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now(), now() + interval '1 day',
            now() + interval '2 days', '11111111-0000-0000-0000-000000000004')$$,
  '23514', null,
  'accepted_at after the deadline is rejected (cannot accept an expired invite)'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, created_at, expires_at, revoked_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'f3@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now(), now() + interval '1 day', now() + interval '2 days')$$,
  '23514', null,
  'revoked_at after the deadline is rejected (cannot revoke an expired invite)'
);
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_profile_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'f4@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now(), now() + interval '7 days',
            now() - interval '1 hour', '11111111-0000-0000-0000-000000000004')$$,
  '23514', null,
  'accepted_at before creation is rejected'
);

-- ===========================================================================
-- anon cannot reach either RPC (no execute grant, no PUBLIC).
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"anon"}', true);
select throws_ok(
  $$select public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
      'anon@example.com', 'stylist'::public.membership_role)$$,
  '42501', null, 'anon cannot execute the create RPC'
);
select throws_ok(
  $$select public.revoke_salon_invite('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon cannot execute the revoke RPC'
);

-- ===========================================================================
-- OWNER: direct-write denial, create paths, server-fixed fields, reinvite, revoke.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- A direct write is refused at the privilege level, RPC or nothing.
select throws_ok(
  $$insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111', 'direct@example.com', 'stylist',
            '11111111-0000-0000-0000-000000000001', now() + interval '7 days')$$,
  '42501', null, 'authenticated cannot INSERT pending_invites directly'
);
select throws_ok(
  $$update public.pending_invites set revoked_at = now() where email = 'probe@example.com'$$,
  '42501', null, 'authenticated cannot UPDATE pending_invites directly'
);

-- Create paths (owner may seat admins and stylists).
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    'b1@example.com', 'stylist'::public.membership_role),
  null, 'an owner can create a stylist invite'
);
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    'b2@example.com', 'admin'::public.membership_role),
  null, 'an owner can create an admin invite'
);

-- Email is normalised inside the function (lower + btrim). The read must be a
-- SEPARATE statement — a subquery in the same statement as the call runs against
-- the pre-call snapshot and would not see the freshly inserted row.
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    '  Norm@Example.COM  ', 'stylist'::public.membership_role),
  null, 'an owner can create an invite from a messy-cased email'
);
select is(
  (select count(*)::int from public.pending_invites where email = 'norm@example.com'),
  1, 'the create RPC normalises the email (lower + btrim)'
);

-- TTL is exactly 7 days, computed by the server.
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    'ttl@example.com', 'stylist'::public.membership_role),
  null, 'an owner can create an invite whose TTL we then inspect'
);
select is(
  (select expires_at - created_at from public.pending_invites where email = 'ttl@example.com'),
  interval '7 days', 'the server fixes the TTL at exactly 7 days'
);

-- Atomic reap-and-reinvite of a lapsed invite.
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    'reinv@example.com', 'stylist'::public.membership_role),
  null, 'an owner can atomically reap a lapsed invite and re-invite'
);
select is(
  (select count(*)::int from public.pending_invites
     where email = 'reinv@example.com' and expired_at is not null),
  1, 'the lapsed invite was reaped (expired_at set)'
);
select is(
  (select count(*)::int from public.pending_invites
     where email = 'reinv@example.com'
       and accepted_at is null and revoked_at is null and expired_at is null),
  1, 'exactly one fresh live invite exists after reinvite'
);
-- A still-VALID live invite is not overwritten — the second call collides.
select throws_ok(
  $$select public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
      'reinv@example.com', 'stylist'::public.membership_role)$$,
  '23505', null, 'reinvite does not overwrite a still-valid outstanding invite'
);

-- Revoke: owner revokes a live invite; the time is the server's now(), not the
-- caller's (the function takes only the invite id).
select lives_ok(
  $$select public.revoke_salon_invite('dddddddd-0000-0000-0000-000000000001')$$,
  'an owner can revoke a live invite'
);
select is(
  (select revoked_at from public.pending_invites where email = 'd1@example.com'),
  now(), 'the revoke time is the server clock, not a caller argument'
);

-- ===========================================================================
-- ADMIN: may seat stylists, may NOT seat admins.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', true);
select isnt(
  public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
    'b3@example.com', 'stylist'::public.membership_role),
  null, 'an admin can create a stylist invite'
);
select throws_ok(
  $$select public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
      'b4@example.com', 'admin'::public.membership_role)$$,
  '42501', null, 'an admin cannot create an admin invite'
);

-- ===========================================================================
-- STYLIST: no invite powers, no revoke powers.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
      'b5@example.com', 'stylist'::public.membership_role)$$,
  '42501', null, 'a stylist cannot create any invite'
);
select throws_ok(
  $$select public.revoke_salon_invite('dddddddd-0000-0000-0000-000000000002')$$,
  '42501', null, 'a stylist cannot revoke an invite'
);

-- ===========================================================================
-- NON-MEMBER (owner of a DIFFERENT salon): no reach into salon A.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_or_reinvite_salon_invite('aaaaaaaa-1111-1111-1111-111111111111',
      'b6@example.com', 'stylist'::public.membership_role)$$,
  '42501', null, 'a non-member cannot create an invite in another salon'
);
select throws_ok(
  $$select public.revoke_salon_invite('dddddddd-0000-0000-0000-000000000002')$$,
  '42501', null, 'a non-member cannot revoke another salon''s invite'
);

-- ===========================================================================
-- OWNER again: terminal + lapsed invites take the expire/reinvite path, never
-- revoke.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.revoke_salon_invite(
      (select id from public.pending_invites where email = 'd4@example.com'))$$,
  '23001', null, 'an already-revoked invite cannot be revoked again'
);
select throws_ok(
  $$select public.revoke_salon_invite(
      (select id from public.pending_invites where email = 'd5@example.com'))$$,
  '23001', null, 'a lapsed invite is refused revocation (re-invite instead)'
);

select * from finish();
rollback;
