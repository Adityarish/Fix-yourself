-- Run after adding project_url and cron_shared_secret to Supabase Vault.
-- This file is intentionally separate from migrations because each environment has different secret values.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'nestlist-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'nestlist-recurring-horizon',
  '17 2 * * *',
  $$select public.materialize_recurring_tasks(60);$$
);

select cron.schedule(
  'nestlist-retention-maintenance',
  '43 2 * * *',
  $$select public.run_retention_maintenance();$$
);
