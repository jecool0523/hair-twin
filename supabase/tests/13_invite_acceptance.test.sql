-- Authenticated invite acceptance: email binding, terminal-state checks,
-- atomic profile/membership provisioning, idempotency, and RPC ACL.
begin;
select plan(17);

set local role postgres;

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-0000-0000-0000-000000000001', 'owner@example.com', now()),
  ('11111111-0000-0000-0000-000000000010', 'invitee@example.com', now()),
  ('11111111-0000-0000-0000-000000000011', 'other@example.com', now()),
  ('11111111-0000-0000-0000-000000000012', 'expired@example.com', now()),
  ('11111111-0000-0000-0000-000000000013', 'revoked@example.com', now()),
  ('11111111-0000-0000-0000-000000000014', 'conflict@example.com', now()),
  ('11111111-0000-0000-0000-000000000015', 'unconfirmed@example.com', null);

insert into public.profiles (id, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'Owner'),
  ('11111111-0000-0000-0000-000000000014', 'Conflict');
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A');
insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000014', 'stylist');

insert into public.pending_invites
  (id, salon_id, email, role, invited_by, created_at, expires_at, revoked_at)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'invitee@example.com', 'admin', '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '1 day', null),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111',
   'expired@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '2 days', now() - interval '1 day', null),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-1111-1111-1111-111111111111',
   'revoked@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '1 day', now() - interval '1 minute'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'aaaaaaaa-1111-1111-1111-111111111111',
   'conflict@example.com', 'admin', '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '1 day', null),
  ('eeeeeeee-0000-0000-0000-000000000005', 'aaaaaaaa-1111-1111-1111-111111111111',
   'unconfirmed@example.com', 'stylist', '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '1 day', null);

select is(
  (select count(*)::int from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name = 'accept_salon_invite'
     and grantee = 'PUBLIC'),
  0,
  'accept RPC has no PUBLIC execute grant'
);
select isnt(
  has_function_privilege('anon', 'public.accept_salon_invite(uuid,text)', 'execute'),
  true,
  'anon cannot execute accept RPC'
);
select isnt(
  has_function_privilege('service_role', 'public.accept_salon_invite(uuid,text)', 'execute'),
  true,
  'service_role cannot execute accept RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_salon_invite(uuid,text)', 'execute'),
  'authenticated can execute accept RPC'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000015","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000005', 'Unconfirmed')$$,
  '42501', null,
  'an unconfirmed email identity cannot accept an invite'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000001', 'Other')$$,
  '42501', null,
  'a different authenticated email cannot accept the invite'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000012","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000002', 'Expired')$$,
  '23001', null,
  'an expired invite cannot be accepted'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000013","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000003', 'Revoked')$$,
  '23001', null,
  'a revoked invite cannot be accepted'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000014","role":"authenticated"}', true);
select throws_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000004', 'Conflict')$$,
  '23001', null,
  'an existing conflicting membership role is not rewritten by an invite'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000010","role":"authenticated"}', true);

select lives_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000001', 'New Admin')$$,
  'the matching authenticated user can accept a live invite'
);
select is(
  (select display_name from public.profiles where id = '11111111-0000-0000-0000-000000000010'),
  'New Admin',
  'acceptance provisions the profile'
);
select is(
  (select role::text from public.salon_memberships
   where salon_id = 'aaaaaaaa-1111-1111-1111-111111111111'
     and profile_id = '11111111-0000-0000-0000-000000000010'),
  'admin',
  'membership role comes from the invite'
);
select is(
  (select accepted_profile_id from public.pending_invites
   where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000010'::uuid,
  'invite outcome is bound to auth.uid()'
);
select isnt(
  (select accepted_at from public.pending_invites
   where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  null,
  'acceptance time is server-stamped'
);
select is(
  (select count(*)::int from public.audit_events
   where action = 'invite_accepted'
     and detail ->> 'inviteId' = 'eeeeeeee-0000-0000-0000-000000000001'),
  1,
  'acceptance emits one audit event'
);
select lives_ok(
  $$select public.accept_salon_invite('eeeeeeee-0000-0000-0000-000000000001', 'Ignored')$$,
  'repeating acceptance by the same user is idempotent'
);
select results_eq(
  $$select
      (select count(*)::int from public.salon_memberships
       where salon_id = 'aaaaaaaa-1111-1111-1111-111111111111'
         and profile_id = '11111111-0000-0000-0000-000000000010'),
      (select count(*)::int from public.audit_events
       where action = 'invite_accepted'
         and detail ->> 'inviteId' = 'eeeeeeee-0000-0000-0000-000000000001')$$,
  $$values (1, 1)$$,
  'idempotent replay creates neither duplicate membership nor audit event'
);

select * from finish();
rollback;
