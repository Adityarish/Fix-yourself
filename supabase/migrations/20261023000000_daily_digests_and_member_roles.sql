alter table public.profiles
  add column if not exists daily_digest_enabled boolean not null default false,
  add column if not exists daily_digest_time time without time zone not null default '08:00';

create table if not exists public.daily_task_digest_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('queued', 'claimed', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create index if not exists daily_task_digest_claim_idx
  on public.daily_task_digest_deliveries(status, scheduled_for)
  where status in ('queued', 'failed');

alter table public.daily_task_digest_deliveries enable row level security;

create policy daily_task_digest_self_read
  on public.daily_task_digest_deliveries
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.update_notification_preferences(
  p_daily_digest_enabled boolean,
  p_daily_digest_time time without time zone
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_daily_digest_time is null then
    raise exception 'daily summary time is required';
  end if;
  update public.profiles
  set daily_digest_enabled = p_daily_digest_enabled,
      daily_digest_time = p_daily_digest_time,
      updated_at = now()
  where id = auth.uid()
  returning * into v_profile;
  if p_daily_digest_enabled then
    delete from public.daily_task_digest_deliveries delivery
    where delivery.user_id = auth.uid()
      and delivery.local_date = (now() at time zone v_profile.timezone)::date
      and delivery.status = 'cancelled';
    update public.daily_task_digest_deliveries delivery
    set scheduled_for = (
          (delivery.local_date + v_profile.daily_digest_time)
          at time zone v_profile.timezone
        ),
        attempt_count = 0,
        last_error = null
    where delivery.user_id = auth.uid()
      and delivery.local_date = (now() at time zone v_profile.timezone)::date
      and delivery.status in ('queued', 'failed');
  else
    update public.daily_task_digest_deliveries
    set status = 'cancelled'
    where user_id = auth.uid()
      and status in ('queued', 'failed', 'claimed');
  end if;
  return v_profile;
end
$$;

create or replace function public.claim_due_daily_task_digests(
  p_limit integer default 100
)
returns table (
  user_id uuid,
  local_date date,
  scheduled_for timestamptz,
  task_titles text[],
  task_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_task_digest_deliveries(
    user_id,
    local_date,
    scheduled_for,
    status
  )
  select
    p.id,
    (now() at time zone p.timezone)::date,
    (
      (now() at time zone p.timezone)::date + p.daily_digest_time
    ) at time zone p.timezone,
    'queued'
  from public.profiles p
  where p.daily_digest_enabled
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = p.id
        and subscription.revoked_at is null
    )
    and ((
      (now() at time zone p.timezone)::date + p.daily_digest_time
    ) at time zone p.timezone) <= now()
    and exists (
      select 1
      from public.tasks task
      join public.space_members member
        on member.space_id = task.space_id
       and member.user_id = p.id
       and member.status = 'active'
      where task.status = 'open'
        and task.deleted_at is null
        and task.scheduled_date = (now() at time zone p.timezone)::date
    )
  on conflict (user_id, local_date) do nothing;

  return query
  with claims as (
    select delivery.user_id, delivery.local_date
    from public.daily_task_digest_deliveries delivery
    where delivery.status in ('queued', 'failed')
      and delivery.scheduled_for <= now()
      and delivery.attempt_count < 6
    order by delivery.scheduled_for
    for update skip locked
    limit least(greatest(p_limit, 1), 500)
  ), claimed as (
    update public.daily_task_digest_deliveries delivery
    set status = 'claimed',
        attempt_count = delivery.attempt_count + 1,
        last_error = null
    from claims
    where delivery.user_id = claims.user_id
      and delivery.local_date = claims.local_date
    returning delivery.user_id, delivery.local_date, delivery.scheduled_for
  )
  select
    claimed.user_id,
    claimed.local_date,
    claimed.scheduled_for,
    coalesce(tasks.task_titles, array[]::text[]),
    coalesce(tasks.task_count, 0)
  from claimed
  left join lateral (
    select
      array_agg(task.title order by task.rank, task.created_at) as task_titles,
      count(*) as task_count
    from public.tasks task
    join public.space_members member
      on member.space_id = task.space_id
     and member.user_id = claimed.user_id
     and member.status = 'active'
    where task.status = 'open'
      and task.deleted_at is null
      and task.scheduled_date = claimed.local_date
  ) tasks on true;
end
$$;

create or replace function public.update_space_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_role public.member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if not public.is_space_owner(p_space_id) then
    raise exception 'only the Circle owner can change roles' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'role must be admin or member';
  end if;
  update public.space_members
  set role = p_role
  where space_id = p_space_id
    and user_id = p_user_id
    and status = 'active'
    and role <> 'owner';
  if not found then
    raise exception 'active member not found';
  end if;
  insert into public.change_log(
    space_id, entity_type, entity_id, operation, payload, actor_id
  ) values (
    p_space_id,
    'spaceMember',
    p_user_id,
    'upsert',
    jsonb_build_object(
      'space_id', p_space_id,
      'user_id', p_user_id,
      'role', p_role,
      'status', 'active'
    ),
    v_user
  );
end
$$;

revoke all on table public.daily_task_digest_deliveries from public, anon, authenticated;
grant select on table public.daily_task_digest_deliveries to authenticated;

revoke all on function public.update_notification_preferences(boolean, time without time zone) from public;
revoke all on function public.claim_due_daily_task_digests(integer) from public, anon, authenticated;
revoke all on function public.update_space_member_role(uuid, uuid, public.member_role) from public;

grant execute on function public.update_notification_preferences(boolean, time without time zone) to authenticated;
grant execute on function public.claim_due_daily_task_digests(integer) to service_role;
grant execute on function public.update_space_member_role(uuid, uuid, public.member_role) to authenticated;
