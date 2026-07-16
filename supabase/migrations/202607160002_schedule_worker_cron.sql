-- Schedules queue workers via pg_cron + pg_net as a fallback safety net.
-- Primary processing is triggered immediately when jobs are enqueued
-- (see wake-workers.ts). Cron retries stuck messages and covers missed wakes.
--   studio_project_url
--   studio_worker_service_key

create or replace function public.schedule_studio_worker_cron()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job record;
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name in ('studio_project_url', 'studio_worker_service_key')
    having count(*) = 2
  ) then
    raise exception
      'Missing Vault secrets. Run supabase/scripts/setup-vault-secrets.sql first.';
  end if;

  for job in
    select jobid
    from cron.job
    where jobname in (
      'studio-process-moods',
      'studio-process-finals',
      'studio-process-upscales'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;

  perform cron.schedule(
    'studio-process-moods',
    '30 seconds',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'studio_project_url')
        || '/functions/v1/process-mood-queue',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'studio_worker_service_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );

  perform cron.schedule(
    'studio-process-finals',
    '30 seconds',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'studio_project_url')
        || '/functions/v1/process-final-queue',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'studio_worker_service_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );

  perform cron.schedule(
    'studio-process-upscales',
    '30 seconds',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'studio_project_url')
        || '/functions/v1/process-upscale-queue',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'studio_worker_service_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
end;
$$;

revoke all on function public.schedule_studio_worker_cron() from public, anon, authenticated;
grant execute on function public.schedule_studio_worker_cron() to service_role;

-- Apply schedules when Vault secrets already exist (hosted deploys).
do $apply$
begin
  if exists (
    select 1
    from vault.decrypted_secrets
    where name in ('studio_project_url', 'studio_worker_service_key')
    having count(*) = 2
  ) then
    perform public.schedule_studio_worker_cron();
  end if;
exception
  when others then
  raise notice 'Studio worker cron not scheduled yet: %', sqlerrm;
end;
$apply$;
