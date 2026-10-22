create extension if not exists pgtap with schema extensions;
begin;
select plan(9);

select has_function('public','accept_space_invite',array['text'],'invite acceptance RPC exists');
select has_function('public','claim_due_notifications',array['integer'],'atomic notification claim RPC exists');
select has_function('public','materialize_recurring_tasks',array['integer'],'recurrence horizon RPC exists');
select has_function('public','run_retention_maintenance',array[]::text[],'retention maintenance RPC exists');
select has_function('public','queue_routine_notifications',array['integer'],'routine notification queue RPC exists');
select has_function('public','create_space_list',array['uuid','text'],'list creation RPC exists');
select has_table('public','activity_summaries','compacted activity table exists');
select function_privs_are('public','claim_due_notifications',array['integer'],'authenticated',array[]::text[],'browser users cannot claim reminder deliveries');
select ok((select count(*)=0 from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type in ('INSERT','UPDATE','DELETE')),'anonymous role has no direct write grants');

select * from finish();
rollback;
