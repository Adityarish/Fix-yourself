create table public.activity_summaries (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  revision_count integer not null check (revision_count > 0),
  actor_ids uuid[] not null default '{}',
  changed_fields text[] not null default '{}',
  first_before jsonb,
  last_after jsonb,
  created_at timestamptz not null default now(),
  unique (task_id, period_start, period_end)
);

alter table public.activity_summaries enable row level security;

create policy activity_summaries_member_read on public.activity_summaries
for select to authenticated
using (public.is_active_space_member(space_id));

create index activity_summaries_space_period_idx
on public.activity_summaries(space_id, period_start desc);

create or replace function public.create_space_list(
  p_space_id uuid,
  p_name text
)
returns public.lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_list public.lists;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_active_space_member(p_space_id) then
    raise exception 'space access required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'list name must be 1 to 120 characters';
  end if;
  if exists (
    select 1 from public.lists
    where space_id = p_space_id
      and deleted_at is null
      and lower(name) = lower(trim(p_name))
  ) then
    raise exception 'a list with this name already exists';
  end if;
  insert into public.lists(space_id, name, rank, created_by)
  values (
    p_space_id,
    trim(p_name),
    extract(epoch from clock_timestamp())::bigint::text,
    v_user
  ) returning * into v_list;
  insert into public.change_log(
    space_id, entity_type, entity_id, operation, payload, actor_id
  ) values (
    p_space_id, 'list', v_list.id, 'upsert', to_jsonb(v_list), v_user
  );
  return v_list;
end
$$;

create or replace function public.rrule_value(p_rrule text, p_key text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select split_part(part, '=', 2)
  from regexp_split_to_table(upper(p_rrule), ';') as entries(part)
  where split_part(part, '=', 1) = upper(p_key)
  limit 1
$$;

create or replace function public.validate_task_series()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_frequency text := public.rrule_value(new.rrule, 'FREQ');
  v_interval_text text := coalesce(public.rrule_value(new.rrule, 'INTERVAL'), '1');
  v_byday text := public.rrule_value(new.rrule, 'BYDAY');
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'invalid task series timezone';
  end if;
  if v_frequency not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then
    raise exception 'unsupported recurrence frequency';
  end if;
  if v_interval_text !~ '^[0-9]+$'
    or v_interval_text::integer not between 1 and 365 then
    raise exception 'invalid recurrence interval';
  end if;
  if v_byday is not null and exists (
    select 1
    from unnest(string_to_array(v_byday, ',')) as days(day_code)
    where day_code not in ('SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA')
  ) then
    raise exception 'invalid recurrence weekday';
  end if;
  if v_byday is not null and v_frequency <> 'WEEKLY' then
    raise exception 'BYDAY is supported only for weekly recurrence';
  end if;
  if new.until_at is not null and new.until_at < new.start_at then
    raise exception 'series end cannot precede its start';
  end if;
  if new.assignee_id is not null and not exists (
    select 1
    from public.space_members
    where space_id = new.space_id
      and user_id = new.assignee_id
      and status = 'active'
  ) then
    raise exception 'assignee is not an active member';
  end if;
  return new;
end
$$;

create trigger task_series_validate
before insert or update of rrule, timezone, start_at, until_at
on public.task_series
for each row execute function public.validate_task_series();

create or replace function public.materialize_recurring_tasks(
  p_horizon_days integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.task_series%rowtype;
  v_task public.tasks%rowtype;
  v_frequency text;
  v_interval integer;
  v_byday text;
  v_start_date date;
  v_today date;
  v_end_date date;
  v_candidate date;
  v_local_time time;
  v_occurrence timestamptz;
  v_occurrence_key text;
  v_days_since integer;
  v_months_since integer;
  v_last_day integer;
  v_target_day integer;
  v_start_is_month_end boolean;
  v_weekday text;
  v_matches boolean;
  v_created integer := 0;
begin
  if p_horizon_days not between 1 and 366 then
    raise exception 'horizon must be between 1 and 366 days';
  end if;

  for v_series in
    select *
    from public.task_series
    where active and deleted_at is null
  loop
    v_frequency := public.rrule_value(v_series.rrule, 'FREQ');
    v_interval := coalesce(public.rrule_value(v_series.rrule, 'INTERVAL'), '1')::integer;
    v_byday := public.rrule_value(v_series.rrule, 'BYDAY');
    v_start_date := (v_series.start_at at time zone v_series.timezone)::date;
    v_local_time := (v_series.start_at at time zone v_series.timezone)::time;
    v_today := (now() at time zone v_series.timezone)::date;
    v_end_date := v_today + p_horizon_days;
    v_start_is_month_end := extract(day from v_start_date)::integer =
      extract(day from (date_trunc('month', v_start_date) + interval '1 month - 1 day'))::integer;

    for v_candidate in
      select day::date
      from generate_series(
        greatest(v_start_date, v_today)::timestamp,
        v_end_date::timestamp,
        interval '1 day'
      ) as dates(day)
    loop
      v_days_since := v_candidate - v_start_date;
      v_months_since :=
        (extract(year from v_candidate)::integer - extract(year from v_start_date)::integer) * 12
        + extract(month from v_candidate)::integer
        - extract(month from v_start_date)::integer;
      v_last_day := extract(
        day from (date_trunc('month', v_candidate) + interval '1 month - 1 day')
      )::integer;
      v_target_day := case
        when v_start_is_month_end then v_last_day
        else least(extract(day from v_start_date)::integer, v_last_day)
      end;
      v_weekday := case extract(dow from v_candidate)::integer
        when 0 then 'SU' when 1 then 'MO' when 2 then 'TU'
        when 3 then 'WE' when 4 then 'TH' when 5 then 'FR'
        else 'SA'
      end;

      v_matches := case
        when v_byday is not null then
          v_weekday = any(string_to_array(v_byday, ','))
          and (v_days_since / 7) % v_interval = 0
        when v_frequency = 'DAILY' then v_days_since % v_interval = 0
        when v_frequency = 'WEEKLY' then
          extract(dow from v_candidate) = extract(dow from v_start_date)
          and (v_days_since / 7) % v_interval = 0
        when v_frequency = 'MONTHLY' then
          extract(day from v_candidate)::integer = v_target_day
          and v_months_since % v_interval = 0
        when v_frequency = 'YEARLY' then
          extract(month from v_candidate) = extract(month from v_start_date)
          and extract(day from v_candidate)::integer = v_target_day
          and (
            extract(year from v_candidate)::integer
            - extract(year from v_start_date)::integer
          ) % v_interval = 0
        else false
      end;

      if not v_matches then continue; end if;
      v_occurrence := (v_candidate + v_local_time) at time zone v_series.timezone;
      if v_series.until_at is not null and v_occurrence > v_series.until_at then
        continue;
      end if;
      v_occurrence_key := to_char(
        v_occurrence at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      );
      v_task := null;
      insert into public.tasks(
        id, space_id, list_id, creator_id, assignee_id, title, notes,
        status, bucket, effort, scheduled_date, remind_at,
        reminder_timezone, rank, series_id, occurrence_key
      ) values (
        gen_random_uuid(), v_series.space_id, v_series.list_id,
        v_series.creator_id, v_series.assignee_id, v_series.title,
        v_series.notes, 'open',
        case when v_candidate = v_today then 'today'::public.task_bucket
          else 'planned'::public.task_bucket end,
        v_series.effort, v_candidate, v_occurrence, v_series.timezone,
        extract(epoch from v_occurrence)::bigint::text,
        v_series.id, v_occurrence_key
      )
      on conflict (series_id, occurrence_key) where series_id is not null
      do nothing
      returning * into v_task;

      if v_task.id is not null then
        insert into public.task_revisions(
          task_id, version, actor_id, changed_fields, after
        ) values (
          v_task.id, v_task.version, v_series.creator_id,
          array['series_id', 'occurrence_key'], to_jsonb(v_task)
        );
        insert into public.change_log(
          space_id, entity_type, entity_id, operation, payload, actor_id
        ) values (
          v_task.space_id, 'task', v_task.id, 'upsert',
          to_jsonb(v_task), v_series.creator_id
        );
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;
  return v_created;
end
$$;

create or replace function public.run_retention_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compacted integer;
  v_revisions_deleted integer;
  v_changes_deleted integer;
begin
  insert into public.activity_summaries(
    space_id, task_id, period_start, period_end, revision_count,
    actor_ids, changed_fields, first_before, last_after
  )
  select
    t.space_id,
    r.task_id,
    date_trunc('day', r.created_at),
    date_trunc('day', r.created_at) + interval '1 day',
    count(distinct r.id)::integer,
    array_agg(distinct r.actor_id),
    coalesce(
      array_agg(distinct field_name) filter (where field_name is not null),
      '{}'::text[]
    ),
    (array_agg(r.before order by r.created_at, r.id))[1],
    (array_agg(r.after order by r.created_at desc, r.id desc))[1]
  from public.task_revisions r
  join public.tasks t on t.id = r.task_id
    left join lateral unnest(r.changed_fields) as fields(field_name) on true
  where r.created_at < now() - interval '30 days'
  group by t.space_id, r.task_id, date_trunc('day', r.created_at)
  on conflict (task_id, period_start, period_end) do update set
    revision_count = excluded.revision_count,
    actor_ids = excluded.actor_ids,
    changed_fields = excluded.changed_fields,
    first_before = excluded.first_before,
    last_after = excluded.last_after;
  get diagnostics v_compacted = row_count;

  delete from public.task_revisions
  where created_at < now() - interval '30 days';
  get diagnostics v_revisions_deleted = row_count;

  delete from public.change_log
  where created_at < now() - interval '90 days';
  get diagnostics v_changes_deleted = row_count;

  return jsonb_build_object(
    'summariesWritten', v_compacted,
    'revisionsDeleted', v_revisions_deleted,
    'changesDeleted', v_changes_deleted
  );
end
$$;

create or replace function public.queue_routine_notifications(
  p_horizon_days integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_date date;
  v_today date;
  v_scheduled_for timestamptz;
  v_user uuid;
  v_queued integer := 0;
begin
  if p_horizon_days not between 0 and 7 then
    raise exception 'routine notification horizon must be between 0 and 7 days';
  end if;
  for v_row in
    select
      r.id as routine_id,
      r.timezone,
      r.days_of_week,
      r.created_by,
      i.id as item_id,
      i.reminder_local_time,
      i.assignee_id,
      s.owner_id
    from public.routines r
    join public.routine_items i on i.routine_id = r.id
    join public.spaces s on s.id = r.space_id
    where r.active
      and r.deleted_at is null
      and i.deleted_at is null
      and i.reminder_local_time is not null
  loop
    v_today := (now() at time zone v_row.timezone)::date;
    for v_date in
      select day::date
      from generate_series(
        v_today::timestamp,
        (v_today + p_horizon_days)::timestamp,
        interval '1 day'
      ) as dates(day)
    loop
      if not (extract(dow from v_date)::smallint = any(v_row.days_of_week)) then
        continue;
      end if;
      v_user := coalesce(v_row.assignee_id, v_row.created_by, v_row.owner_id);
      v_scheduled_for :=
        (v_date + v_row.reminder_local_time) at time zone v_row.timezone;
      if v_scheduled_for < now() - interval '1 minute' then
        continue;
      end if;
      update public.notification_deliveries
      set status = 'queued', attempt_count = 0, last_error = null
      where user_id = v_user
        and routine_item_id = v_row.item_id
        and task_id is null
        and kind = 'routine-reminder'
        and scheduled_for = v_scheduled_for
        and status = 'cancelled';
      insert into public.notification_deliveries(
        user_id, routine_item_id, kind, scheduled_for, status
      ) values (
        v_user, v_row.item_id, 'routine-reminder', v_scheduled_for, 'queued'
      ) on conflict do nothing;
      if found then v_queued := v_queued + 1; end if;
    end loop;
  end loop;
  return v_queued;
end
$$;

create or replace function public.queue_task_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  if new.remind_at is null or new.deleted_at is not null or new.status <> 'open' then
    update public.notification_deliveries
    set status = 'cancelled'
    where task_id = new.id and status in ('queued', 'failed', 'claimed');
    return new;
  end if;
  select coalesce(new.assignee_id, s.owner_id)
  into v_user
  from public.spaces s
  where s.id = new.space_id;

  update public.notification_deliveries
  set status = 'cancelled'
  where task_id = new.id
    and status in ('queued', 'failed', 'claimed')
    and (scheduled_for <> new.remind_at or user_id <> v_user);

  update public.notification_deliveries
  set status = 'queued', attempt_count = 0, last_error = null
  where user_id = v_user
    and task_id = new.id
    and routine_item_id is null
    and kind = 'task-reminder'
    and scheduled_for = new.remind_at
    and status = 'cancelled';

  insert into public.notification_deliveries(
    user_id, task_id, kind, scheduled_for, status
  ) values (
    v_user, new.id, 'task-reminder', new.remind_at, 'queued'
  ) on conflict do nothing;
  return new;
end
$$;

create or replace function public.reflect_routine_completion_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_local_date date;
  v_timezone text;
begin
  if tg_op = 'DELETE' then
    v_item_id := old.routine_item_id;
    v_local_date := old.local_date;
  else
    v_item_id := new.routine_item_id;
    v_local_date := new.local_date;
  end if;
  select r.timezone
  into v_timezone
  from public.routine_items i
  join public.routines r on r.id = i.routine_id
  where i.id = v_item_id;

  if tg_op = 'DELETE' then
    update public.notification_deliveries
    set status = 'queued', attempt_count = 0, last_error = null
    where routine_item_id = v_item_id
      and status = 'cancelled'
      and scheduled_for > now()
      and (scheduled_for at time zone v_timezone)::date = v_local_date;
  else
    update public.notification_deliveries
    set status = 'cancelled'
    where routine_item_id = v_item_id
      and status in ('queued', 'failed', 'claimed')
      and (scheduled_for at time zone v_timezone)::date = v_local_date;
  end if;
  return null;
end
$$;

create trigger routine_completion_notification_state
after insert or delete on public.routine_item_completions
for each row execute function public.reflect_routine_completion_notification();

create or replace function public.cancel_changed_routine_item_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null
    or new.reminder_local_time is distinct from old.reminder_local_time
    or new.assignee_id is distinct from old.assignee_id then
    update public.notification_deliveries
    set status = 'cancelled'
    where routine_item_id = new.id
      and status in ('queued', 'failed', 'claimed')
      and scheduled_for > now();
  end if;
  return new;
end
$$;

create trigger routine_item_notification_changes
after update of deleted_at, reminder_local_time, assignee_id
on public.routine_items
for each row execute function public.cancel_changed_routine_item_notifications();

create or replace function public.cancel_inactive_routine_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.active or new.deleted_at is not null then
    update public.notification_deliveries d
    set status = 'cancelled'
    from public.routine_items i
    where i.routine_id = new.id
      and d.routine_item_id = i.id
      and d.status in ('queued', 'failed', 'claimed')
      and d.scheduled_for > now();
  end if;
  return new;
end
$$;

create trigger routine_notification_changes
after update of active, deleted_at on public.routines
for each row execute function public.cancel_inactive_routine_notifications();

create or replace function public.workspace_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_user),
    'spaces', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.spaces s where s.deleted_at is null and public.is_active_space_member(s.id)),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('display_name', p.display_name, 'avatar_url', p.avatar_url)), '[]') from public.space_members m left join public.profiles p on p.id = m.user_id where m.status = 'active' and public.is_active_space_member(m.space_id)),
    'lists', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.lists l where l.deleted_at is null and public.is_active_space_member(l.space_id)),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.tasks t where public.is_active_space_member(t.space_id)),
    'taskSeries', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.task_series s where s.deleted_at is null and public.is_active_space_member(s.space_id)),
    'routines', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.routines r where r.deleted_at is null and public.is_active_space_member(r.space_id)),
    'routineItems', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.routine_items i join public.routines r on r.id = i.routine_id where i.deleted_at is null and public.is_active_space_member(r.space_id)),
    'routineCompletions', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.routine_item_completions c join public.routine_items i on i.id = c.routine_item_id join public.routines r on r.id = i.routine_id where public.is_active_space_member(r.space_id)),
    'capacities', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.daily_capacity_overrides c where c.user_id = v_user),
    'conflicts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.sync_conflicts c where c.user_id = v_user and c.reviewed_at is null)
  );
end
$$;

revoke all on table public.activity_summaries from public, anon, authenticated;
revoke all on function public.create_space_list(uuid, text) from public;
revoke all on function public.rrule_value(text, text) from public, anon, authenticated;
revoke all on function public.validate_task_series() from public, anon, authenticated;
revoke all on function public.materialize_recurring_tasks(integer) from public, anon, authenticated;
revoke all on function public.run_retention_maintenance() from public, anon, authenticated;
revoke all on function public.queue_routine_notifications(integer) from public, anon, authenticated;
revoke all on function public.reflect_routine_completion_notification() from public, anon, authenticated;
revoke all on function public.cancel_changed_routine_item_notifications() from public, anon, authenticated;
revoke all on function public.cancel_inactive_routine_notifications() from public, anon, authenticated;
grant execute on function public.materialize_recurring_tasks(integer) to service_role;
grant execute on function public.run_retention_maintenance() to service_role;
grant execute on function public.queue_routine_notifications(integer) to service_role;
grant execute on function public.create_space_list(uuid, text) to authenticated;
grant select on public.activity_summaries to authenticated;
