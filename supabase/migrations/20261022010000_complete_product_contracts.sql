create extension if not exists pgcrypto with schema extensions;

alter table public.profiles add column if not exists week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6);
alter table public.profiles add column if not exists theme text not null default 'system' check (theme in ('system','light','dark'));

create or replace function public.can_edit_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.tasks t
    join public.space_members m on m.space_id = t.space_id and m.user_id = auth.uid() and m.status = 'active'
    where t.id = p_task_id and (m.role in ('owner','admin') or t.creator_id = auth.uid() or t.assignee_id = auth.uid())
  )
$$;

create or replace function public.create_circle(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_space public.spaces; v_list public.lists;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if char_length(trim(p_name)) not between 1 and 120 then raise exception 'Circle name must be 1 to 120 characters'; end if;
  insert into public.spaces(kind,name,owner_id,color,icon) values('circle',trim(p_name),v_user,'#739b87','users') returning * into v_space;
  insert into public.space_members(space_id,user_id,role,status) values(v_space.id,v_user,'owner','active');
  insert into public.lists(space_id,name,rank,created_by) values(v_space.id,'Inbox','a0',v_user) returning * into v_list;
  insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id)
    values(v_space.id,'space',v_space.id,'upsert',to_jsonb(v_space),v_user),
          (v_space.id,'list',v_list.id,'upsert',to_jsonb(v_list),v_user);
  return jsonb_build_object('space_id',v_space.id,'inbox_list_id',v_list.id);
end $$;

create or replace function public.create_space_invite(p_space_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_token text; v_hash text; v_invite uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.space_members where space_id=p_space_id and user_id=v_user and status='active' and role in ('owner','admin')) then
    raise exception 'only Circle owners and admins can invite' using errcode='42501';
  end if;
  if p_email is null or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid email'; end if;
  if (select count(*) from public.space_invites where invited_by=v_user and created_at > now()-interval '1 hour') >= 20 then raise exception 'invite rate limit reached'; end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_hash := encode(extensions.digest(v_token,'sha256'),'hex');
  insert into public.space_invites(space_id,email,token_hash,invited_by,expires_at) values(p_space_id,lower(trim(p_email)),v_hash,v_user,now()+interval '7 days') returning id into v_invite;
  return jsonb_build_object('invite_id',v_invite,'raw_token',v_token,'expires_at',now()+interval '7 days');
end $$;

create or replace function public.accept_space_invite(p_raw_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_email text; v_invite public.space_invites;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if char_length(coalesce(p_raw_token,'')) < 32 then raise exception 'invalid invitation'; end if;
  select * into v_invite from public.space_invites where token_hash=encode(extensions.digest(p_raw_token,'sha256'),'hex') for update;
  if v_invite.id is null or v_invite.revoked_at is not null or v_invite.accepted_at is not null or v_invite.expires_at <= now() then raise exception 'invitation is invalid or expired'; end if;
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  if v_invite.email is not null and lower(v_invite.email::text) <> v_email then raise exception 'sign in with the invited email address' using errcode='42501'; end if;
  insert into public.space_members(space_id,user_id,role,status,joined_at,removed_at) values(v_invite.space_id,v_user,v_invite.role,'active',now(),null)
    on conflict(space_id,user_id) do update set role=excluded.role,status='active',joined_at=now(),removed_at=null;
  update public.space_invites set accepted_at=now() where id=v_invite.id;
  insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id)
    values(v_invite.space_id,'spaceMember',v_user,'upsert',jsonb_build_object('space_id',v_invite.space_id,'user_id',v_user,'role',v_invite.role,'status','active'),v_user);
  return v_invite.space_id;
end $$;

create or replace function public.remove_space_member(p_space_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if not public.is_space_owner(p_space_id) then raise exception 'only the Circle owner can remove members' using errcode='42501'; end if;
  if p_user_id=v_user then raise exception 'transfer ownership before leaving'; end if;
  update public.space_members set status='removed',removed_at=now() where space_id=p_space_id and user_id=p_user_id and role <> 'owner';
  if not found then raise exception 'active member not found'; end if;
  insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id)
    values(p_space_id,'spaceMember',p_user_id,'delete',jsonb_build_object('space_id',p_space_id,'user_id',p_user_id),v_user);
end $$;

create or replace function public.workspace_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  return jsonb_build_object(
    'spaces',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.spaces s where s.deleted_at is null and public.is_active_space_member(s.id)),
    'members',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('display_name',p.display_name,'avatar_url',p.avatar_url)),'[]') from public.space_members m left join public.profiles p on p.id=m.user_id where m.status='active' and public.is_active_space_member(m.space_id)),
    'lists',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.lists l where l.deleted_at is null and public.is_active_space_member(l.space_id)),
    'taskSeries',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.task_series s where s.deleted_at is null and public.is_active_space_member(s.space_id)),
    'routines',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.routines r where r.deleted_at is null and public.is_active_space_member(r.space_id)),
    'routineItems',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.routine_items i join public.routines r on r.id=i.routine_id where i.deleted_at is null and public.is_active_space_member(r.space_id)),
    'routineCompletions',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.routine_item_completions c join public.routine_items i on i.id=c.routine_item_id join public.routines r on r.id=i.routine_id where public.is_active_space_member(r.space_id)),
    'capacities',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.daily_capacity_overrides c where c.user_id=v_user),
    'conflicts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.sync_conflicts c where c.user_id=v_user and c.reviewed_at is null)
  );
end $$;

create or replace function public.update_profile_settings(p_display_name text, p_timezone text, p_default_capacity smallint, p_week_starts_on smallint, p_theme text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_display_name,''))) not between 1 and 120 then raise exception 'invalid display name'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid timezone'; end if;
  if p_default_capacity not between 1 and 40 or p_week_starts_on not between 0 and 6 or p_theme not in ('system','light','dark') then raise exception 'invalid profile setting'; end if;
  update public.profiles set display_name=trim(p_display_name),timezone=p_timezone,default_capacity=p_default_capacity,week_starts_on=p_week_starts_on,theme=p_theme,updated_at=now() where id=auth.uid() returning * into v_profile;
  return v_profile;
end $$;

create or replace function public.claim_due_notifications(p_limit integer default 100)
returns setof public.notification_deliveries language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claims as (
    select id from public.notification_deliveries
    where status in ('queued','failed') and scheduled_for <= now() and attempt_count < 6
    order by scheduled_for for update skip locked limit least(greatest(p_limit,1),500)
  )
  update public.notification_deliveries d set status='claimed',attempt_count=d.attempt_count+1,last_error=null
  from claims where d.id=claims.id returning d.*;
end $$;

create or replace function public.queue_task_reminder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if new.remind_at is null or new.deleted_at is not null or new.status <> 'open' then
    update public.notification_deliveries set status='cancelled' where task_id=new.id and status in ('queued','failed','claimed');
    return new;
  end if;
  select coalesce(new.assignee_id,s.owner_id) into v_user from public.spaces s where s.id=new.space_id;
  insert into public.notification_deliveries(user_id,task_id,kind,scheduled_for,status)
    values(v_user,new.id,'task-reminder',new.remind_at,'queued') on conflict do nothing;
  return new;
end $$;

create trigger tasks_queue_reminder after insert or update of remind_at,status,assignee_id,deleted_at on public.tasks
for each row execute function public.queue_task_reminder();

revoke all on function public.create_circle(text) from public;
revoke all on function public.create_space_invite(uuid,text) from public;
revoke all on function public.accept_space_invite(text) from public;
revoke all on function public.remove_space_member(uuid,uuid) from public;
revoke all on function public.workspace_snapshot() from public;
revoke all on function public.update_profile_settings(text,text,smallint,smallint,text) from public;
revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
revoke all on function public.can_edit_task(uuid) from public;
grant execute on function public.create_circle(text), public.create_space_invite(uuid,text), public.accept_space_invite(text), public.remove_space_member(uuid,uuid), public.workspace_snapshot(), public.update_profile_settings(text,text,smallint,smallint,text), public.can_edit_task(uuid) to authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;

create policy series_member_write on public.task_series for all to authenticated
  using (public.is_active_space_member(space_id)) with check (creator_id=auth.uid() and public.is_active_space_member(space_id));

create index if not exists change_log_retention_idx on public.change_log(created_at);
create index if not exists deliveries_claim_idx on public.notification_deliveries(status,scheduled_for) where status in ('queued','failed');
create index if not exists invites_rate_idx on public.space_invites(invited_by,created_at);
