-- Removes all test/stuck jobs and drains queued messages for a clean slate.
-- Run this in the Supabase Dashboard SQL Editor.
-- Safe to re-run; it only touches data, not schema, functions, or queues themselves.

-- 1. Purge queued/in-flight pgmq messages (mood, final, upscale).
select pgmq.purge_queue('mood_generation');
select pgmq.purge_queue('final_generation');
select pgmq.purge_queue('upscale_generation');

-- 2. Delete all jobs. job_generations and usage_events cascade automatically.
delete from public.album_jobs;

-- 3. Clear any leftover worker leases (should already be empty once jobs are gone).
delete from public.worker_leases;

-- 4. Optional: reset rate limits so you don't hit CREATE_JOB_RATE_LIMIT_PER_HOUR
--    while testing. Comment this out if you want to keep rate-limit history.
delete from public.rate_limits;

-- Sanity check: everything should now be empty.
select
  (select count(*) from public.album_jobs) as jobs,
  (select count(*) from public.job_generations) as generations,
  (select count(*) from public.worker_leases) as leases,
  (select count(*) from pgmq.q_mood_generation) as mood_queue,
  (select count(*) from pgmq.q_final_generation) as final_queue,
  (select count(*) from pgmq.q_upscale_generation) as upscale_queue;
