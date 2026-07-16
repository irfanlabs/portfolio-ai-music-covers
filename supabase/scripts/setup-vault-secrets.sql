-- Run once in Supabase Dashboard → SQL Editor.
-- Replace the service role key placeholder before executing.

-- Remove previous secrets if you are re-running this script.
delete from vault.secrets
where name in ('studio_project_url', 'studio_worker_service_key');

select vault.create_secret(
  'https://izezbwhdmpefcosfagkt.supabase.co',
  'studio_project_url',
  'Project URL for studio queue workers'
);

select vault.create_secret(
  'PASTE_YOUR_SERVICE_ROLE_KEY_HERE',
  'studio_worker_service_key',
  'Service role key for studio queue workers'
);

-- Register cron jobs (every minute).
select public.schedule_studio_worker_cron();

-- Verify scheduled jobs.
select jobid, jobname, schedule, active
from cron.job
where jobname like 'studio-process-%'
order by jobname;
