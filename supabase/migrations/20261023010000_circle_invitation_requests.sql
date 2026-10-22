alter table public.space_invites
  add column if not exists declined_at timestamptz,
  add column if not exists email_delivery_status text not null default 'pending'
    check (email_delivery_status in ('pending', 'sent', 'failed')),
  add column if not exists email_delivered_at timestamptz,
  add column if not exists email_delivery_error text;

create index if not exists space_invites_recipient_idx
  on public.space_invites(lower(email::text), created_at desc);

create or replace function public.create_space_invite(
  p_space_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_token text;
  v_hash text;
  v_invite uuid;
  v_circle_name text;
  v_inviter_name text;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.space_members member
    where member.space_id = p_space_id
      and member.user_id = v_user
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'only Circle owners and admins can invite' using errcode = '42501';
  end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;
  if (
    select count(*)
    from public.space_invites invite
    where invite.invited_by = v_user
      and invite.created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'invite rate limit reached';
  end if;
  if exists (
    select 1
    from public.space_members member
    join auth.users invited_user on invited_user.id = member.user_id
    where member.space_id = p_space_id
      and member.status = 'active'
      and lower(invited_user.email) = v_email
  ) then
    raise exception 'this person is already a Circle member';
  end if;

  update public.space_invites invite
  set revoked_at = now()
  where invite.space_id = p_space_id
    and lower(invite.email::text) = v_email
    and invite.accepted_at is null
    and invite.declined_at is null
    and invite.revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.space_invites(
    space_id,
    email,
    token_hash,
    invited_by,
    expires_at
  ) values (
    p_space_id,
    v_email,
    v_hash,
    v_user,
    v_expires_at
  ) returning id into v_invite;

  select space.name into v_circle_name
  from public.spaces space
  where space.id = p_space_id;

  select coalesce(nullif(trim(profile.display_name), ''), 'A Circle admin')
  into v_inviter_name
  from public.profiles profile
  where profile.id = v_user;

  return jsonb_build_object(
    'invite_id', v_invite,
    'raw_token', v_token,
    'expires_at', v_expires_at,
    'circle_name', v_circle_name,
    'inviter_name', coalesce(v_inviter_name, 'A Circle admin')
  );
end
$$;

create or replace function public.list_my_circle_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invites jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_email = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(invitation.item order by invitation.created_at desc), '[]'::jsonb)
  into v_invites
  from (
    select
      invite.created_at,
      jsonb_build_object(
        'id', invite.id,
        'spaceId', invite.space_id,
        'circleName', space.name,
        'role', invite.role,
        'invitedBy', invite.invited_by,
        'invitedByName', coalesce(nullif(trim(profile.display_name), ''), 'A Circle admin'),
        'createdAt', invite.created_at,
        'expiresAt', invite.expires_at
      ) as item
    from public.space_invites invite
    join public.spaces space on space.id = invite.space_id
    left join public.profiles profile on profile.id = invite.invited_by
    where lower(invite.email::text) = v_email
      and invite.accepted_at is null
      and invite.declined_at is null
      and invite.revoked_at is null
      and invite.expires_at > now()
      and space.deleted_at is null
  ) invitation;

  return v_invites;
end
$$;

create or replace function public.list_circle_invites(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_invites jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.space_members member
    where member.space_id = p_space_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'only Circle owners and admins can view invitations' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(invitation.item order by invitation.created_at desc), '[]'::jsonb)
  into v_invites
  from (
    select
      invite.created_at,
      jsonb_build_object(
        'id', invite.id,
        'email', invite.email,
        'role', invite.role,
        'status', case
          when invite.accepted_at is not null then 'accepted'
          when invite.declined_at is not null then 'declined'
          when invite.revoked_at is not null then 'revoked'
          when invite.expires_at <= now() then 'expired'
          else 'pending'
        end,
        'emailDeliveryStatus', invite.email_delivery_status,
        'emailDeliveryError', invite.email_delivery_error,
        'createdAt', invite.created_at,
        'expiresAt', invite.expires_at
      ) as item
    from public.space_invites invite
    where invite.space_id = p_space_id
    order by invite.created_at desc
    limit 100
  ) invitation;

  return v_invites;
end
$$;

create or replace function public.respond_to_space_invite(
  p_invite_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite public.space_invites;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'a response is required';
  end if;

  select * into v_invite
  from public.space_invites invite
  where invite.id = p_invite_id
  for update;

  if v_invite.id is null
    or v_invite.revoked_at is not null
    or v_invite.accepted_at is not null
    or v_invite.declined_at is not null
    or v_invite.expires_at <= now() then
    raise exception 'invitation is invalid or expired';
  end if;
  if lower(v_invite.email::text) <> v_email then
    raise exception 'sign in with the invited email address' using errcode = '42501';
  end if;

  if p_accept then
    insert into public.space_members(
      space_id,
      user_id,
      role,
      status,
      joined_at,
      removed_at
    ) values (
      v_invite.space_id,
      v_user,
      v_invite.role,
      'active',
      now(),
      null
    )
    on conflict(space_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        joined_at = now(),
        removed_at = null;

    update public.space_invites
    set accepted_at = now()
    where id = v_invite.id;

    insert into public.change_log(
      space_id,
      entity_type,
      entity_id,
      operation,
      payload,
      actor_id
    ) values (
      v_invite.space_id,
      'spaceMember',
      v_user,
      'upsert',
      jsonb_build_object(
        'space_id', v_invite.space_id,
        'user_id', v_user,
        'role', v_invite.role,
        'status', 'active'
      ),
      v_user
    );

    return jsonb_build_object('spaceId', v_invite.space_id, 'status', 'accepted');
  end if;

  update public.space_invites
  set declined_at = now()
  where id = v_invite.id;

  return jsonb_build_object('spaceId', v_invite.space_id, 'status', 'declined');
end
$$;

create or replace function public.accept_space_invite(p_raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invite public.space_invites;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(coalesce(p_raw_token, '')) < 32 then
    raise exception 'invalid invitation';
  end if;
  select * into v_invite
  from public.space_invites invite
  where invite.token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
  for update;
  if v_invite.id is null
    or v_invite.revoked_at is not null
    or v_invite.accepted_at is not null
    or v_invite.declined_at is not null
    or v_invite.expires_at <= now() then
    raise exception 'invitation is invalid or expired';
  end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if lower(v_invite.email::text) <> v_email then
    raise exception 'sign in with the invited email address' using errcode = '42501';
  end if;
  insert into public.space_members(space_id, user_id, role, status, joined_at, removed_at)
  values(v_invite.space_id, v_user, v_invite.role, 'active', now(), null)
  on conflict(space_id, user_id) do update
  set role = excluded.role,
      status = 'active',
      joined_at = now(),
      removed_at = null;
  update public.space_invites set accepted_at = now() where id = v_invite.id;
  insert into public.change_log(space_id, entity_type, entity_id, operation, payload, actor_id)
  values(
    v_invite.space_id,
    'spaceMember',
    v_user,
    'upsert',
    jsonb_build_object(
      'space_id', v_invite.space_id,
      'user_id', v_user,
      'role', v_invite.role,
      'status', 'active'
    ),
    v_user
  );
  return v_invite.space_id;
end
$$;

create or replace function public.record_space_invite_delivery(
  p_invite_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid delivery status';
  end if;
  update public.space_invites invite
  set email_delivery_status = p_status,
      email_delivered_at = case when p_status = 'sent' then now() else null end,
      email_delivery_error = case when p_status = 'failed' then left(coalesce(p_error, 'Email delivery failed.'), 500) else null end
  where invite.id = p_invite_id
    and invite.invited_by = auth.uid();
  if not found then
    raise exception 'invitation not found' using errcode = '42501';
  end if;
end
$$;

revoke all on function public.list_my_circle_invites() from public;
revoke all on function public.list_circle_invites(uuid) from public;
revoke all on function public.respond_to_space_invite(uuid, boolean) from public;
revoke all on function public.record_space_invite_delivery(uuid, text, text) from public;

grant execute on function public.list_my_circle_invites() to authenticated;
grant execute on function public.list_circle_invites(uuid) to authenticated;
grant execute on function public.respond_to_space_invite(uuid, boolean) to authenticated;
grant execute on function public.record_space_invite_delivery(uuid, text, text) to authenticated;
