-- Hair Twin -- authenticated invite acceptance and membership provisioning.
--
-- The Supabase Auth invite link proves control of the invited email and creates
-- an authenticated user. This RPC then binds that user to the DB-authoritative
-- pending invite. No role, salon, email, or acceptance time is caller supplied.

create function public.accept_salon_invite(
  p_invite_id uuid,
  p_display_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_invite public.pending_invites%rowtype;
  v_membership_id uuid;
  v_existing_role public.membership_role;
begin
  if v_uid is null then
    raise exception 'no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select lower(btrim(u.email))
    into v_email
    from auth.users u
   where u.id = v_uid;

  if v_email is null then
    raise exception 'authenticated user has no verified email identity'
      using errcode = 'insufficient_privilege';
  end if;

  select *
    into v_invite
    from public.pending_invites
   where id = p_invite_id
   for update;

  if not found then
    raise exception 'invite % not found', p_invite_id
      using errcode = 'no_data_found';
  end if;

  -- A repeated request by the same accepted user is idempotent. It never
  -- creates a second membership or duplicate audit event.
  if v_invite.accepted_profile_id = v_uid then
    select id into v_membership_id
      from public.salon_memberships
     where salon_id = v_invite.salon_id and profile_id = v_uid;
    if v_membership_id is null then
      raise exception 'accepted invite % has no membership', p_invite_id
        using errcode = 'integrity_constraint_violation';
    end if;
    return v_membership_id;
  end if;

  if v_invite.accepted_at is not null
     or v_invite.revoked_at is not null
     or v_invite.expired_at is not null
  then
    raise exception 'invite % is already terminal', p_invite_id
      using errcode = 'restrict_violation';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'invite % has expired', p_invite_id
      using errcode = 'restrict_violation';
  end if;

  if v_email <> v_invite.email then
    raise exception 'authenticated email does not match invite %', p_invite_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.profiles (id, display_name)
  values (
    v_uid,
    coalesce(nullif(btrim(p_display_name), ''), split_part(v_email, '@', 1))
  )
  on conflict (id) do nothing;

  select id, role
    into v_membership_id, v_existing_role
    from public.salon_memberships
   where salon_id = v_invite.salon_id and profile_id = v_uid;

  if v_membership_id is not null and v_existing_role <> v_invite.role then
    raise exception 'existing membership role conflicts with invite %', p_invite_id
      using errcode = 'restrict_violation';
  end if;

  if v_membership_id is null then
    insert into public.salon_memberships (salon_id, profile_id, role)
    values (v_invite.salon_id, v_uid, v_invite.role)
    returning id into v_membership_id;
  end if;

  update public.pending_invites
     set accepted_at = now(), accepted_profile_id = v_uid
   where id = p_invite_id;

  insert into public.audit_events (salon_id, action, actor_id, detail)
  values (
    v_invite.salon_id,
    'invite_accepted',
    v_uid::text,
    jsonb_build_object(
      'inviteId', p_invite_id,
      'membershipId', v_membership_id,
      'role', v_invite.role
    )
  );

  return v_membership_id;
end;
$$;

revoke execute on function public.accept_salon_invite(uuid, text) from public;
revoke execute on function public.accept_salon_invite(uuid, text) from anon;
revoke execute on function public.accept_salon_invite(uuid, text) from service_role;
grant execute on function public.accept_salon_invite(uuid, text) to authenticated;

comment on function public.accept_salon_invite(uuid, text) is
  'Accepts one live invite for auth.uid() after matching auth.users.email; atomically provisions profile, membership, invite outcome, and audit evidence.';
