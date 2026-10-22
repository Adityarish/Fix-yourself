create extension if not exists pgtap with schema extensions;
begin;
select plan(11);

select ok(not exists(
  select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
), 'every public application table has RLS enabled');

insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','alice@example.com'),
  ('10000000-0000-4000-8000-000000000002','bob@example.com'),
  ('10000000-0000-4000-8000-000000000003','carol@example.com');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","email":"alice@example.com"}',true);
select lives_ok($$ select public.bootstrap_user('20000000-0000-4000-8000-000000000001') $$,'Alice bootstraps idempotently');
select lives_ok($$ select public.bootstrap_user('20000000-0000-4000-8000-000000000001') $$,'duplicate bootstrap is harmless');
select lives_ok($$ select public.create_circle('Family') $$,'Alice can create a Circle');
reset role;

select is((select count(*)::integer from public.spaces where owner_id='10000000-0000-4000-8000-000000000001' and kind='personal'),1,'one personal space is created');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","email":"bob@example.com"}',true);
select is((select count(*)::integer from public.spaces where kind='circle'),0,'unrelated user cannot read Alice Circle');
reset role;

insert into public.space_members(space_id,user_id,role,status)
select id,'10000000-0000-4000-8000-000000000002','member','active' from public.spaces where kind='circle' and owner_id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","email":"bob@example.com"}',true);
select is((select count(*)::integer from public.spaces where kind='circle'),1,'active member can read the Circle');
reset role;

update public.space_members set status='removed',removed_at=now() where user_id='10000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","email":"bob@example.com"}',true);
select is((select count(*)::integer from public.spaces where kind='circle'),0,'removed member loses access immediately');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","email":"alice@example.com"}',true);
select is(
  (select (public.push_mutations('20000000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object(
    'mutationId','30000000-0000-4000-8000-000000000001','deviceId','20000000-0000-4000-8000-000000000001','entityType','task','entityId','40000000-0000-4000-8000-000000000001',
    'spaceId',s.id,'operation','create','patch',jsonb_build_object('listId',l.id,'title','Buy medicine','bucket','later','effort','normal','scheduledDate',null,'rank','a0')
  )))->0->>'status' from public.spaces s join public.lists l on l.space_id=s.id where s.kind='personal' and s.owner_id=auth.uid()),
  'accepted','first mutation is accepted'
);
select is(
  (select (public.push_mutations('20000000-0000-4000-8000-000000000001',jsonb_build_array(jsonb_build_object(
    'mutationId','30000000-0000-4000-8000-000000000001','deviceId','20000000-0000-4000-8000-000000000001','entityType','task','entityId','40000000-0000-4000-8000-000000000001',
    'spaceId',s.id,'operation','create','patch',jsonb_build_object('listId',l.id,'title','Buy medicine','bucket','later','effort','normal','scheduledDate',null,'rank','a0')
  )))->0->>'status' from public.spaces s join public.lists l on l.space_id=s.id where s.kind='personal' and s.owner_id=auth.uid()),
  'duplicate','replayed mutation is reported as duplicate'
);
select is((select count(*)::integer from public.tasks where id='40000000-0000-4000-8000-000000000001'),1,'mutation replay creates no duplicate task');
select is((public.pull_changes(0,100)->'accessibleSpaceIds') ? (select id::text from public.spaces where kind='personal' and owner_id=auth.uid()),true,'pull includes the current accessible-space set');
reset role;

select * from finish();
rollback;
