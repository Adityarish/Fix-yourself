create or replace function public.push_mutations(p_device_id uuid, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_item jsonb; v_results jsonb := '[]'; v_result jsonb;
  v_mutation uuid; v_id uuid; v_space uuid; v_entity text; v_op text; v_patch jsonb; v_base bigint;
  v_before jsonb; v_after jsonb; v_version bigint; v_overlap text[]; v_conflict uuid;
  v_task public.tasks; v_routine public.routines; v_routine_item public.routine_items;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 100 then raise exception 'batch must contain at most 100 mutations'; end if;
  if octet_length(p_batch::text) > 1048576 then raise exception 'mutation batch is too large'; end if;
  if not exists(select 1 from public.devices where id=p_device_id and user_id=v_user and revoked_at is null) then raise exception 'invalid device' using errcode='42501'; end if;
  if (select count(*) from public.processed_mutations where user_id=v_user and processed_at > now()-interval '1 minute') > 1200 then raise exception 'mutation rate limit reached'; end if;

  for v_item in select value from jsonb_array_elements(p_batch) loop
    v_conflict := null;
    v_overlap := null;
    v_before := null;
    v_after := null;
    begin
      if jsonb_typeof(v_item) <> 'object' or not (v_item ?& array['mutationId','deviceId','entityType','entityId','spaceId','operation','patch']) then raise exception 'mutation is missing required fields'; end if;
      v_mutation := (v_item->>'mutationId')::uuid; v_id := (v_item->>'entityId')::uuid; v_space := (v_item->>'spaceId')::uuid;
      v_entity := v_item->>'entityType'; v_op := v_item->>'operation'; v_patch := v_item->'patch'; v_base := nullif(v_item->>'baseVersion','')::bigint;
      if (v_item->>'deviceId')::uuid <> p_device_id then raise exception 'mutation device does not match batch device'; end if;
      if jsonb_typeof(v_patch) <> 'object' then raise exception 'mutation patch must be an object'; end if;
      if not public.is_active_space_member(v_space) then
        v_result := jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','forbidden','message','No access to this space');
        v_results := v_results || jsonb_build_array(v_result); continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_mutation::text,0));
      select result into v_result from public.processed_mutations where mutation_id=v_mutation and user_id=v_user;
      if v_result is not null then
        if v_result->>'status' in ('accepted','conflict') then v_result := v_result || jsonb_build_object('status','duplicate'); end if;
        v_results := v_results || jsonb_build_array(v_result); continue;
      end if;

      if v_entity = 'task' then
        if v_op = 'create' then
          if char_length(coalesce(v_patch->>'title','')) not between 1 and 500 then raise exception 'invalid title'; end if;
          if v_patch->>'assigneeId' is not null and not exists(select 1 from public.space_members where space_id=v_space and user_id=(v_patch->>'assigneeId')::uuid and status='active') then raise exception 'assignee is not an active member'; end if;
          insert into public.tasks(id,space_id,list_id,creator_id,assignee_id,title,notes,status,bucket,effort,scheduled_date,remind_at,reminder_timezone,rank,series_id,occurrence_key)
          values(v_id,v_space,(v_patch->>'listId')::uuid,v_user,nullif(v_patch->>'assigneeId','')::uuid,v_patch->>'title',v_patch->>'notes','open',
            (v_patch->>'bucket')::public.task_bucket,(v_patch->>'effort')::public.task_effort,nullif(v_patch->>'scheduledDate','')::date,
            nullif(v_patch->>'remindAt','')::timestamptz,v_patch->>'reminderTimezone',coalesce(v_patch->>'rank','a0'),
            nullif(v_patch->>'seriesId','')::uuid,v_patch->>'occurrenceKey') returning * into v_task;
          v_after := to_jsonb(v_task); v_version := v_task.version;
          insert into public.task_revisions(task_id,version,actor_id,device_id,mutation_id,changed_fields,after)
            values(v_id,v_version,v_user,p_device_id,v_mutation,array(select jsonb_object_keys(v_patch)),v_after);
        else
          select * into v_task from public.tasks where id=v_id and space_id=v_space and deleted_at is null for update;
          if v_task.id is null then raise exception 'task not found'; end if;
          v_before := to_jsonb(v_task); v_version := v_task.version;
          if v_op in ('patch','reorder','drop','delete') and not public.can_edit_task(v_id) then
            v_result := jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','forbidden','message','Only the creator, assignee, or a space admin can edit this task');
            insert into public.processed_mutations values(v_mutation,v_user,p_device_id,v_entity,v_id,v_result,now());
            v_results := v_results || jsonb_build_array(v_result); continue;
          end if;
          if v_op='delete' and not public.is_space_owner(v_space) then
            v_result := jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','forbidden','message','Only the space owner can delete a task');
            insert into public.processed_mutations values(v_mutation,v_user,p_device_id,v_entity,v_id,v_result,now());
            v_results := v_results || jsonb_build_array(v_result); continue;
          end if;
          if v_patch->>'assigneeId' is not null and not exists(select 1 from public.space_members where space_id=v_space and user_id=(v_patch->>'assigneeId')::uuid and status='active') then raise exception 'assignee is not an active member'; end if;
          select coalesce(array_agg(distinct field),'{}') into v_overlap
            from public.task_revisions revision cross join lateral unnest(revision.changed_fields) field
            where revision.task_id=v_id and revision.version > coalesce(v_base,v_version) and v_patch ? field;
          if v_op='complete' then
            update public.tasks set status='completed',completed_at=now(),completed_by=v_user,dropped_at=null,version=version+1,updated_at=now() where id=v_id returning * into v_task;
          elsif v_op='reopen' then
            update public.tasks set status='open',completed_at=null,completed_by=null,dropped_at=null,version=version+1,updated_at=now() where id=v_id returning * into v_task;
          elsif v_op='drop' then
            update public.tasks set status='dropped',dropped_at=now(),completed_at=null,completed_by=null,version=version+1,updated_at=now() where id=v_id returning * into v_task;
          elsif v_op in ('patch','reorder') then
            if v_patch ? 'title' and char_length(v_patch->>'title') not between 1 and 500 then raise exception 'invalid title'; end if;
            update public.tasks set
              list_id=case when v_patch ? 'listId' then (v_patch->>'listId')::uuid else list_id end,
              title=case when v_patch ? 'title' then v_patch->>'title' else title end,
              notes=case when v_patch ? 'notes' then v_patch->>'notes' else notes end,
              assignee_id=case when v_patch ? 'assigneeId' then nullif(v_patch->>'assigneeId','')::uuid else assignee_id end,
              bucket=case when v_patch ? 'bucket' then (v_patch->>'bucket')::public.task_bucket else bucket end,
              effort=case when v_patch ? 'effort' then (v_patch->>'effort')::public.task_effort else effort end,
              scheduled_date=case when v_patch ? 'scheduledDate' then nullif(v_patch->>'scheduledDate','')::date else scheduled_date end,
              remind_at=case when v_patch ? 'remindAt' then nullif(v_patch->>'remindAt','')::timestamptz else remind_at end,
              reminder_timezone=case when v_patch ? 'reminderTimezone' then v_patch->>'reminderTimezone' else reminder_timezone end,
              rank=case when v_patch ? 'rank' then v_patch->>'rank' else rank end,
              postpone_count=postpone_count + case
                when (scheduled_date is not null and v_patch ? 'scheduledDate' and nullif(v_patch->>'scheduledDate','')::date > scheduled_date)
                  or (bucket='today' and v_patch->>'bucket'='later') then 1 else 0 end,
              version=version+1,updated_at=now() where id=v_id returning * into v_task;
          elsif v_op='delete' then
            update public.tasks set deleted_at=now(),version=version+1,updated_at=now() where id=v_id returning * into v_task;
          else raise exception 'unsupported task operation'; end if;
          v_after := to_jsonb(v_task); v_version := v_task.version;
          insert into public.task_revisions(task_id,version,actor_id,device_id,mutation_id,changed_fields,before,after)
            values(v_id,v_version,v_user,p_device_id,v_mutation,array(select jsonb_object_keys(v_patch)),v_before,v_after);
          if cardinality(v_overlap)>0 then
            insert into public.sync_conflicts(user_id,device_id,space_id,entity_type,entity_id,mutation_id,overlapping_fields,server_before,client_patch,resolved_value,resolution)
              values(v_user,p_device_id,v_space,'task',v_id,v_mutation,v_overlap,v_before,v_patch,v_after,'client_last_write') returning id into v_conflict;
          end if;
        end if;
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id)
          values(v_space,'task',v_id,case when v_op='delete' then 'delete' else 'upsert' end,v_after,v_user);
        v_result := jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status',case when v_conflict is null then 'accepted' else 'conflict' end,'serverVersion',v_version,'serverEntity',v_after,'conflictId',v_conflict);

      elsif v_entity = 'routine' then
        if v_op='create' then
          insert into public.routines(id,space_id,title,timezone,days_of_week,active,rank,created_by)
            values(v_id,v_space,v_patch->>'title',v_patch->>'timezone',array(select jsonb_array_elements_text(v_patch->'daysOfWeek')::smallint),true,coalesce(v_patch->>'rank','a0'),v_user) returning * into v_routine;
        elsif v_op='delete' then
          update public.routines set deleted_at=now(),updated_at=now() where id=v_id and space_id=v_space returning * into v_routine;
        else
          update public.routines set title=coalesce(v_patch->>'title',title),timezone=coalesce(v_patch->>'timezone',timezone),
            days_of_week=case when v_patch ? 'daysOfWeek' then array(select jsonb_array_elements_text(v_patch->'daysOfWeek')::smallint) else days_of_week end,
            active=case when v_patch ? 'active' then (v_patch->>'active')::boolean else active end,rank=coalesce(v_patch->>'rank',rank),updated_at=now()
            where id=v_id and space_id=v_space returning * into v_routine;
        end if;
        if v_routine.id is null then raise exception 'routine not found'; end if;
        v_after:=to_jsonb(v_routine);
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'routine',v_id,case when v_op='delete' then 'delete' else 'upsert' end,v_after,v_user);
        v_result:=jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','accepted','serverEntity',v_after);

      elsif v_entity = 'routineItem' then
        if v_patch->>'assigneeId' is not null and not exists(select 1 from public.space_members where space_id=v_space and user_id=(v_patch->>'assigneeId')::uuid and status='active') then raise exception 'assignee is not an active member'; end if;
        if v_op='create' then
          if not exists(select 1 from public.routines where id=(v_patch->>'routineId')::uuid and space_id=v_space) then raise exception 'routine not found'; end if;
          insert into public.routine_items(id,routine_id,title,notes,reminder_local_time,assignee_id,rank)
            values(v_id,(v_patch->>'routineId')::uuid,v_patch->>'title',v_patch->>'notes',nullif(v_patch->>'reminderLocalTime','')::time,nullif(v_patch->>'assigneeId','')::uuid,coalesce(v_patch->>'rank','a0')) returning * into v_routine_item;
        elsif v_op='delete' then
          update public.routine_items i set deleted_at=now(),updated_at=now() from public.routines r where i.id=v_id and r.id=i.routine_id and r.space_id=v_space returning i.* into v_routine_item;
        else
          update public.routine_items i set title=coalesce(v_patch->>'title',i.title),notes=case when v_patch ? 'notes' then v_patch->>'notes' else i.notes end,
            reminder_local_time=case when v_patch ? 'reminderLocalTime' then nullif(v_patch->>'reminderLocalTime','')::time else i.reminder_local_time end,
            assignee_id=case when v_patch ? 'assigneeId' then nullif(v_patch->>'assigneeId','')::uuid else i.assignee_id end,rank=coalesce(v_patch->>'rank',i.rank),updated_at=now()
            from public.routines r where i.id=v_id and r.id=i.routine_id and r.space_id=v_space returning i.* into v_routine_item;
        end if;
        if v_routine_item.id is null then raise exception 'routine item not found'; end if;
        v_after:=to_jsonb(v_routine_item);
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'routineItem',v_id,case when v_op='delete' then 'delete' else 'upsert' end,v_after,v_user);
        v_result:=jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','accepted','serverEntity',v_after);

      elsif v_entity = 'routineCompletion' then
        if not exists(select 1 from public.routine_items i join public.routines r on r.id=i.routine_id where i.id=v_id and r.space_id=v_space) then raise exception 'routine item not found'; end if;
        if v_op='complete' then
          insert into public.routine_item_completions(routine_item_id,local_date,completed_by,completed_at)
            values(v_id,(v_patch->>'localDate')::date,v_user,coalesce(nullif(v_patch->>'completedAt','')::timestamptz,now()))
            on conflict(routine_item_id,local_date) do update set completed_by=excluded.completed_by,completed_at=excluded.completed_at;
          select to_jsonb(c) into v_after from public.routine_item_completions c where routine_item_id=v_id and local_date=(v_patch->>'localDate')::date;
        else
          delete from public.routine_item_completions where routine_item_id=v_id and local_date=(v_patch->>'localDate')::date;
          v_after:=jsonb_build_object('routine_item_id',v_id,'local_date',v_patch->>'localDate','deleted',true);
        end if;
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'routineCompletion',v_id,case when v_op='complete' then 'upsert' else 'delete' end,v_after,v_user);
        v_result:=jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','accepted','serverEntity',v_after);

      elsif v_entity = 'taskSeries' then
        if v_op='create' then
          insert into public.task_series(id,space_id,list_id,creator_id,assignee_id,title,notes,effort,rrule,timezone,start_at,until_at,active)
            values(v_id,v_space,(v_patch->>'listId')::uuid,v_user,nullif(v_patch->>'assigneeId','')::uuid,v_patch->>'title',v_patch->>'notes',(v_patch->>'effort')::public.task_effort,v_patch->>'rrule',v_patch->>'timezone',(v_patch->>'startAt')::timestamptz,nullif(v_patch->>'untilAt','')::timestamptz,true);
        elsif v_op='delete' then
          update public.task_series set deleted_at=now(),active=false,updated_at=now() where id=v_id and space_id=v_space;
        else
          update public.task_series set title=coalesce(v_patch->>'title',title),notes=case when v_patch ? 'notes' then v_patch->>'notes' else notes end,
            assignee_id=case when v_patch ? 'assigneeId' then nullif(v_patch->>'assigneeId','')::uuid else assignee_id end,
            rrule=coalesce(v_patch->>'rrule',rrule),timezone=coalesce(v_patch->>'timezone',timezone),active=case when v_patch ? 'active' then (v_patch->>'active')::boolean else active end,updated_at=now()
            where id=v_id and space_id=v_space;
        end if;
        select to_jsonb(s) into v_after from public.task_series s where id=v_id;
        if v_after is null then raise exception 'task series not found'; end if;
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'taskSeries',v_id,case when v_op='delete' then 'delete' else 'upsert' end,v_after,v_user);
        v_result:=jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','accepted','serverEntity',v_after);

      elsif v_entity = 'capacity' then
        insert into public.daily_capacity_overrides(user_id,local_date,capacity) values(v_user,(v_patch->>'localDate')::date,(v_patch->>'capacity')::smallint)
          on conflict(user_id,local_date) do update set capacity=excluded.capacity;
        select to_jsonb(c) into v_after from public.daily_capacity_overrides c where user_id=v_user and local_date=(v_patch->>'localDate')::date;
        insert into public.change_log(space_id,entity_type,entity_id,operation,payload,actor_id) values(v_space,'capacity',v_user,'upsert',v_after,v_user);
        v_result:=jsonb_build_object('mutationId',v_mutation,'entityType',v_entity,'entityId',v_id,'status','accepted','serverEntity',v_after);
      else raise exception 'unsupported entity type'; end if;

      insert into public.processed_mutations(mutation_id,user_id,device_id,entity_type,entity_id,result) values(v_mutation,v_user,p_device_id,v_entity,v_id,v_result);
      v_results := v_results || jsonb_build_array(v_result);
      v_conflict:=null; v_overlap:=null; v_before:=null; v_after:=null;
    exception when others then
      v_result:=jsonb_build_object('mutationId',coalesce(v_item->>'mutationId',''),'entityType',coalesce(v_item->>'entityType',''),'entityId',coalesce(v_item->>'entityId',''),'status','invalid','message',sqlerrm);
      v_results:=v_results || jsonb_build_array(v_result);
    end;
  end loop;
  return v_results;
end $$;

create or replace function public.pull_changes(p_cursor bigint default 0, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_changes jsonb; v_next bigint; v_more boolean; v_spaces jsonb; v_change_count bigint;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sequence',c.sequence,'spaceId',c.space_id,'entityType',c.entity_type,'entityId',c.entity_id,'operation',c.operation,'payload',c.payload,'actorId',c.actor_id,'createdAt',c.created_at) order by c.sequence),'[]'),coalesce(max(c.sequence),p_cursor),count(*)
    into v_changes,v_next,v_change_count from (select * from public.change_log where sequence>p_cursor and public.is_active_space_member(space_id) order by sequence limit least(greatest(p_limit,1),500)) c;
  -- The caller hydrates a complete workspace snapshot before pulling. If retention
  -- removed every row after an old cursor, fast-forward to avoid a stuck cursor.
  if v_change_count=0 then
    select greatest(p_cursor,coalesce(max(sequence),p_cursor)) into v_next from public.change_log;
  end if;
  select exists(select 1 from public.change_log where sequence>v_next and public.is_active_space_member(space_id)) into v_more;
  select coalesce(jsonb_agg(m.space_id),'[]') into v_spaces from public.space_members m join public.spaces s on s.id=m.space_id where m.user_id=v_user and m.status='active' and s.deleted_at is null;
  return jsonb_build_object('changes',v_changes,'nextCursor',v_next,'hasMore',v_more,'accessibleSpaceIds',v_spaces,'serverTime',now());
end $$;
