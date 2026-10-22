create extension if not exists citext with schema extensions;

create type public.space_kind as enum ('personal', 'circle');
create type public.member_role as enum ('owner', 'admin', 'member');
create type public.member_status as enum ('active', 'removed');
create type public.task_status as enum ('open', 'completed', 'dropped');
create type public.task_bucket as enum ('today', 'planned', 'later');
create type public.task_effort as enum ('quick', 'normal', 'deep');
create type public.mutation_state as enum ('pending', 'sending', 'blocked', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  default_capacity smallint not null default 8 check (default_capacity between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  platform text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, user_id)
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index spaces_one_personal_space_per_owner on public.spaces(owner_id) where kind = 'personal' and deleted_at is null;

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  status public.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (space_id, user_id)
);

create table public.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  email extensions.citext,
  token_hash text not null unique,
  role public.member_role not null default 'member' check (role <> 'owner'),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  color text,
  icon text,
  rank text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, space_id)
);

create table public.tasks (
  id uuid primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  list_id uuid not null,
  creator_id uuid not null references auth.users(id),
  assignee_id uuid,
  title text not null check (char_length(title) between 1 and 500),
  notes text check (char_length(notes) <= 20000),
  status public.task_status not null default 'open',
  bucket public.task_bucket not null default 'later',
  effort public.task_effort not null default 'normal',
  scheduled_date date,
  remind_at timestamptz,
  reminder_timezone text,
  rank text not null,
  postpone_count integer not null default 0 check (postpone_count >= 0),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  dropped_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  series_id uuid,
  occurrence_key text,
  foreign key (list_id, space_id) references public.lists(id, space_id),
  check ((bucket = 'later' and scheduled_date is null) or (bucket <> 'later' and scheduled_date is not null)),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'completed') = (completed_by is not null)),
  check ((status = 'dropped') = (dropped_at is not null))
);
create unique index tasks_series_occurrence_unique on public.tasks(series_id, occurrence_key) where series_id is not null;
create index tasks_space_date_rank on public.tasks(space_id, scheduled_date, rank) where deleted_at is null;

create table public.task_revisions (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  version bigint not null,
  actor_id uuid not null references auth.users(id),
  device_id uuid,
  mutation_id uuid,
  changed_fields text[] not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  unique (task_id, version)
);

create table public.task_series (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  list_id uuid not null,
  creator_id uuid not null references auth.users(id),
  assignee_id uuid references auth.users(id),
  title text not null,
  notes text,
  effort public.task_effort not null default 'normal',
  rrule text not null,
  timezone text not null,
  start_at timestamptz not null,
  until_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (list_id, space_id) references public.lists(id, space_id)
);
alter table public.tasks add constraint tasks_series_fk foreign key (series_id) references public.task_series(id) on delete set null;

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  title text not null,
  timezone text not null,
  days_of_week smallint[] not null check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  active boolean not null default true,
  rank text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.routine_items (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  title text not null,
  notes text,
  reminder_local_time time,
  assignee_id uuid references auth.users(id),
  rank text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.routine_item_completions (
  routine_item_id uuid not null references public.routine_items(id) on delete cascade,
  local_date date not null,
  completed_by uuid not null references auth.users(id),
  completed_at timestamptz not null default now(),
  primary key (routine_item_id, local_date)
);

create table public.daily_capacity_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  capacity smallint not null check (capacity between 1 and 40),
  primary key (user_id, local_date)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  foreign key (device_id, user_id) references public.devices(id, user_id) on delete cascade
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  routine_item_id uuid references public.routine_items(id) on delete cascade,
  kind text not null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('queued','claimed','sent','failed','cancelled')),
  attempt_count integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(task_id, routine_item_id) = 1)
);
create unique index notification_deliveries_idempotent on public.notification_deliveries(user_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(routine_item_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, scheduled_for);

create table public.processed_mutations (
  mutation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  result jsonb not null,
  processed_at timestamptz not null default now(),
  foreign key (device_id, user_id) references public.devices(id, user_id) on delete cascade
);

create table public.change_log (
  sequence bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('upsert','delete')),
  payload jsonb,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid,
  space_id uuid references public.spaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  mutation_id uuid not null,
  overlapping_fields text[] not null,
  server_before jsonb,
  client_patch jsonb,
  resolved_value jsonb,
  resolution text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create or replace function public.is_active_space_member(p_space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.space_members m where m.space_id = p_space_id and m.user_id = auth.uid() and m.status = 'active')
$$;

create or replace function public.is_space_owner(p_space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.space_members m where m.space_id = p_space_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner')
$$;

create or replace function public.bootstrap_user(p_device_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_space_id uuid; v_list_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  insert into public.profiles(id, display_name) values(v_user_id, coalesce(auth.jwt()->'user_metadata'->>'full_name', split_part(auth.jwt()->>'email','@',1))) on conflict(id) do nothing;
  insert into public.devices(id, user_id, name, platform, last_seen_at) values(p_device_id, v_user_id, 'This device', 'web', now())
  on conflict(id) do update set last_seen_at = now(), revoked_at = null where public.devices.user_id = v_user_id;
  select id into v_space_id from public.spaces where owner_id = v_user_id and kind = 'personal' and deleted_at is null limit 1;
  if v_space_id is null then
    insert into public.spaces(kind, name, owner_id) values('personal', 'Personal', v_user_id) returning id into v_space_id;
    insert into public.space_members(space_id, user_id, role) values(v_space_id, v_user_id, 'owner');
  end if;
  select id into v_list_id from public.lists where space_id = v_space_id and name = 'Inbox' and deleted_at is null limit 1;
  if v_list_id is null then
    insert into public.lists(space_id, name, rank, created_by) values(v_space_id, 'Inbox', 'a0', v_user_id) returning id into v_list_id;
  end if;
  return jsonb_build_object('personal_space_id', v_space_id, 'inbox_list_id', v_list_id, 'device_id', p_device_id);
end $$;

create or replace function public.push_mutations(p_device_id uuid, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_item jsonb; v_result jsonb; v_results jsonb := '[]'::jsonb; v_id uuid; v_mutation uuid; v_space uuid; v_base bigint; v_before jsonb; v_after jsonb; v_version bigint; v_status text; v_op text; v_patch jsonb;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 100 then raise exception 'batch must contain at most 100 mutations'; end if;
  if octet_length(p_batch::text) > 1048576 then raise exception 'mutation batch is too large'; end if;
  if not exists(select 1 from public.devices d where d.id = p_device_id and d.user_id = v_user_id and d.revoked_at is null) then raise exception 'invalid device' using errcode = '42501'; end if;
  for v_item in select value from jsonb_array_elements(p_batch) loop
    begin
      if jsonb_typeof(v_item) <> 'object' or not (v_item ?& array['mutationId','deviceId','entityType','entityId','spaceId','operation','patch']) then raise exception 'mutation is missing required fields'; end if;
      v_mutation := (v_item->>'mutationId')::uuid;
      v_id := (v_item->>'entityId')::uuid;
      v_space := (v_item->>'spaceId')::uuid;
      v_op := v_item->>'operation'; v_patch := v_item->'patch';
      if (v_item->>'deviceId')::uuid <> p_device_id then raise exception 'mutation device does not match batch device'; end if;
      if jsonb_typeof(v_patch) <> 'object' then raise exception 'mutation patch must be an object'; end if;
      if v_item->>'entityType' <> 'task' then raise exception 'unsupported entity type'; end if;
      if not public.is_active_space_member(v_space) then
        v_result := jsonb_build_object('mutationId',v_mutation,'entityType','task','entityId',v_id,'status','forbidden','message','No access to this space');
        v_results := v_results || jsonb_build_array(v_result);
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_mutation::text, 0));
      select result into v_result from public.processed_mutations where mutation_id = v_mutation and user_id = v_user_id;
      if v_result is not null then
        if v_result->>'status' = 'accepted' then v_result := v_result || jsonb_build_object('status','duplicate'); end if;
        v_results := v_results || jsonb_build_array(v_result);
        continue;
      end if;
      if v_op = 'create' then
        if char_length(coalesce(v_patch->>'title','')) not between 1 and 500 then raise exception 'invalid title'; end if;
        insert into public.tasks(id,space_id,list_id,creator_id,title,notes,status,bucket,effort,scheduled_date,remind_at,rank)
        values(v_id,v_space,(v_patch->>'listId')::uuid,v_user_id,v_patch->>'title',v_patch->>'notes','open',(v_patch->>'bucket')::public.task_bucket,(v_patch->>'effort')::public.task_effort,nullif(v_patch->>'scheduledDate','')::date,nullif(v_patch->>'remindAt','')::timestamptz,coalesce(v_patch->>'rank','a0'));
        select to_jsonb(t), t.version into v_after,v_version from public.tasks t where t.id=v_id;
        insert into public.task_revisions(task_id,version,actor_id,device_id,mutation_id,changed_fields,after) values(v_id,v_version,v_user_id,p_device_id,v_mutation,array['title','bucket','effort','scheduled_date'],v_after);
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'task',v_id,'upsert',v_after,v_user_id);
        v_result := jsonb_build_object('mutationId',v_mutation,'entityType','task','entityId',v_id,'status','accepted','serverVersion',v_version,'serverEntity',v_after);
      else
        select to_jsonb(t), t.version into v_before,v_version from public.tasks t where t.id=v_id and t.space_id=v_space and t.deleted_at is null for update;
        if v_before is null then raise exception 'task not found'; end if;
        if v_op in ('patch','reorder','drop','delete')
          and not public.is_space_owner(v_space)
          and not exists(select 1 from public.space_members m where m.space_id=v_space and m.user_id=v_user_id and m.status='active' and m.role='admin')
          and coalesce((v_before->>'creator_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id
          and coalesce((v_before->>'assignee_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id then
          v_result := jsonb_build_object('mutationId',v_mutation,'entityType','task','entityId',v_id,'status','forbidden','message','Only the creator, assignee, or a space admin can edit this task');
          insert into public.processed_mutations(mutation_id,user_id,device_id,entity_type,entity_id,result) values(v_mutation,v_user_id,p_device_id,'task',v_id,v_result);
          v_results := v_results || jsonb_build_array(v_result);
          continue;
        end if;
        if v_op='delete' and not public.is_space_owner(v_space) then
          v_result := jsonb_build_object('mutationId',v_mutation,'entityType','task','entityId',v_id,'status','forbidden','message','Only the space owner can delete a task');
          insert into public.processed_mutations(mutation_id,user_id,device_id,entity_type,entity_id,result) values(v_mutation,v_user_id,p_device_id,'task',v_id,v_result);
          v_results := v_results || jsonb_build_array(v_result);
          continue;
        end if;
        v_base := nullif(v_item->>'baseVersion','')::bigint;
        if v_op = 'complete' then
          update public.tasks set status='completed',completed_at=now(),completed_by=v_user_id,dropped_at=null,version=version+1,updated_at=now() where id=v_id;
        elsif v_op = 'reopen' then
          update public.tasks set status='open',completed_at=null,completed_by=null,dropped_at=null,version=version+1,updated_at=now() where id=v_id;
        elsif v_op = 'drop' then
          update public.tasks set status='dropped',dropped_at=now(),completed_at=null,completed_by=null,version=version+1,updated_at=now() where id=v_id;
        elsif v_op in ('patch','reorder') then
          if v_patch ? 'title' and char_length(v_patch->>'title') not between 1 and 500 then raise exception 'invalid title'; end if;
          update public.tasks set
            title=coalesce(v_patch->>'title',title),
            bucket=coalesce((v_patch->>'bucket')::public.task_bucket,bucket),
            effort=coalesce((v_patch->>'effort')::public.task_effort,effort),
            scheduled_date=case when v_patch ? 'scheduledDate' then nullif(v_patch->>'scheduledDate','')::date else scheduled_date end,
            remind_at=case when v_patch ? 'remindAt' then nullif(v_patch->>'remindAt','')::timestamptz else remind_at end,
            rank=coalesce(v_patch->>'rank',rank),
            postpone_count=coalesce((v_patch->>'postponeCount')::integer,postpone_count),
            version=version+1,updated_at=now() where id=v_id;
        elsif v_op='delete' then update public.tasks set deleted_at=now(),version=version+1,updated_at=now() where id=v_id;
        else raise exception 'unsupported task operation'; end if;
        select to_jsonb(t),t.version into v_after,v_version from public.tasks t where t.id=v_id;
        insert into public.task_revisions(task_id,version,actor_id,device_id,mutation_id,changed_fields,before,after) values(v_id,v_version,v_user_id,p_device_id,array(select jsonb_object_keys(v_patch)),v_before,v_after);
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'task',v_id,case when v_op='delete' then 'delete' else 'upsert' end,v_after,v_user_id);
        v_result := jsonb_build_object('mutationId',v_mutation,'entityType','task','entityId',v_id,'status','accepted','serverVersion',v_version,'serverEntity',v_after);
      end if;
      insert into public.processed_mutations(mutation_id,user_id,device_id,entity_type,entity_id,result) values(v_mutation,v_user_id,p_device_id,'task',v_id,v_result);
      v_results := v_results || jsonb_build_array(v_result);
    exception when others then
      v_result := jsonb_build_object('mutationId',coalesce(v_item->>'mutationId',''),'entityType',coalesce(v_item->>'entityType',''),'entityId',coalesce(v_item->>'entityId',''),'status','invalid','message',sqlerrm);
      v_results := v_results || jsonb_build_array(v_result);
    end;
  end loop;
  return v_results;
end $$;

create or replace function public.pull_changes(p_cursor bigint default 0, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_changes jsonb; v_next bigint; v_more boolean; v_spaces jsonb;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sequence',c.sequence,'spaceId',c.space_id,'entityType',c.entity_type,'entityId',c.entity_id,'operation',c.operation,'payload',c.payload) order by c.sequence),'[]'::jsonb), coalesce(max(c.sequence),p_cursor)
    into v_changes,v_next from (select c.* from public.change_log c where c.sequence > p_cursor and public.is_active_space_member(c.space_id) order by c.sequence limit least(greatest(p_limit,1),500)) c;
  select exists(select 1 from public.change_log c where c.sequence > v_next and public.is_active_space_member(c.space_id)) into v_more;
  select coalesce(jsonb_agg(m.space_id),'[]'::jsonb) into v_spaces from public.space_members m join public.spaces s on s.id=m.space_id where m.user_id=v_user_id and m.status='active' and s.deleted_at is null;
  return jsonb_build_object('changes',v_changes,'nextCursor',v_next,'hasMore',v_more,'accessibleSpaceIds',v_spaces,'serverTime',now());
end $$;

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;
alter table public.task_revisions enable row level security;
alter table public.task_series enable row level security;
alter table public.routines enable row level security;
alter table public.routine_items enable row level security;
alter table public.routine_item_completions enable row level security;
alter table public.daily_capacity_overrides enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.processed_mutations enable row level security;
alter table public.change_log enable row level security;
alter table public.sync_conflicts enable row level security;

create policy profiles_self on public.profiles for all to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy devices_self on public.devices for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy spaces_member_read on public.spaces for select to authenticated using (public.is_active_space_member(id));
create policy members_read on public.space_members for select to authenticated using (public.is_active_space_member(space_id));
create policy lists_member_read on public.lists for select to authenticated using (public.is_active_space_member(space_id));
create policy tasks_member_read on public.tasks for select to authenticated using (public.is_active_space_member(space_id));
create policy tasks_member_insert on public.tasks for insert to authenticated with check (creator_id=auth.uid() and public.is_active_space_member(space_id));
create policy tasks_member_update on public.tasks for update to authenticated using (
  public.is_active_space_member(space_id) and (
    public.is_space_owner(space_id) or exists(select 1 from public.space_members m where m.space_id=tasks.space_id and m.user_id=auth.uid() and m.status='active' and m.role='admin') or creator_id = auth.uid() or assignee_id = auth.uid()
  )
) with check (public.is_active_space_member(space_id));
create policy revisions_member_read on public.task_revisions for select to authenticated using (exists(select 1 from public.tasks t where t.id=task_id and public.is_active_space_member(t.space_id)));
create policy series_member_read on public.task_series for select to authenticated using (public.is_active_space_member(space_id));
create policy routines_member_all on public.routines for all to authenticated using (public.is_active_space_member(space_id)) with check (public.is_active_space_member(space_id));
create policy routine_items_member_all on public.routine_items for all to authenticated using (exists(select 1 from public.routines r where r.id=routine_id and public.is_active_space_member(r.space_id))) with check (exists(select 1 from public.routines r where r.id=routine_id and public.is_active_space_member(r.space_id)));
create policy routine_completions_member_all on public.routine_item_completions for all to authenticated using (exists(select 1 from public.routine_items i join public.routines r on r.id=i.routine_id where i.id=routine_item_id and public.is_active_space_member(r.space_id))) with check (completed_by=auth.uid() and exists(select 1 from public.routine_items i join public.routines r on r.id=i.routine_id where i.id=routine_item_id and public.is_active_space_member(r.space_id)));
create policy capacity_self on public.daily_capacity_overrides for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy subscriptions_self on public.push_subscriptions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy deliveries_self_read on public.notification_deliveries for select to authenticated using (user_id=auth.uid());
create policy conflicts_self on public.sync_conflicts for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

revoke all on function public.bootstrap_user(uuid) from public;
revoke all on function public.push_mutations(uuid,jsonb) from public;
revoke all on function public.pull_changes(bigint,integer) from public;
revoke all on function public.is_active_space_member(uuid) from public;
revoke all on function public.is_space_owner(uuid) from public;
grant execute on function public.bootstrap_user(uuid) to authenticated;
grant execute on function public.push_mutations(uuid,jsonb) to authenticated;
grant execute on function public.pull_changes(bigint,integer) to authenticated;
grant execute on function public.is_active_space_member(uuid) to authenticated;
grant execute on function public.is_space_owner(uuid) to authenticated;

alter table public.spaces replica identity full;
alter table public.tasks replica identity full;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.space_members;

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
