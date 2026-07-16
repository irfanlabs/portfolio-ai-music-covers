-- AI Image Studio: schema, security, queues, storage, and atomic workflow RPCs.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$ begin
  create type public.album_job_status as enum (
    'pending_moods', 'moods_ready', 'pending_final', 'final_ready',
    'pending_upscale', 'complete', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.generation_kind as enum ('mood', 'final', 'revision', 'upscale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.generation_status as enum (
    'queued', 'processing', 'complete', 'retrying', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.album_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 3 and 2000),
  status public.album_job_status not null default 'pending_moods',
  mood_round integer not null default 1 check (mood_round between 1 and 100),
  selected_generation_id uuid,
  current_generation_id uuid,
  error_code text,
  error_message text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_generations (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.album_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.generation_kind not null,
  status public.generation_status not null default 'queued',
  mood_round integer check (mood_round is null or mood_round > 0),
  mood_slot smallint check (mood_slot is null or mood_slot between 0 and 3),
  prompt text not null check (char_length(prompt) between 3 and 4000),
  modifier text,
  seed bigint,
  model text not null,
  resolution text not null,
  source_generation_id uuid references public.job_generations(id),
  object_path text,
  mime_type text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mood_shape check (
    (kind = 'mood' and mood_round is not null and mood_slot is not null and modifier is not null and seed is not null)
    or (kind <> 'mood' and mood_round is null and mood_slot is null)
  ),
  unique (job_id, kind, mood_round, mood_slot)
);

do $$ begin
  alter table public.album_jobs
    add constraint album_jobs_selected_generation_fk
    foreign key (selected_generation_id) references public.job_generations(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.album_jobs
    add constraint album_jobs_current_generation_fk
    foreign key (current_generation_id) references public.job_generations(id);
exception when duplicate_object then null; end $$;

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.album_jobs(id) on delete cascade,
  generation_id uuid references public.job_generations(id) on delete set null,
  provider text not null default 'openrouter',
  model text not null,
  request_id text,
  cost_usd numeric(12, 8) check (cost_usd is null or cost_usd >= 0),
  input_units bigint check (input_units is null or input_units >= 0),
  output_units bigint check (output_units is null or output_units >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.worker_leases (
  slot_no integer primary key check (slot_no > 0),
  lease_token uuid,
  worker_id text,
  generation_id uuid references public.job_generations(id) on delete set null,
  queue_name text,
  acquired_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  subject_id uuid not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_id, action)
);

create index if not exists album_jobs_user_created_idx on public.album_jobs(user_id, created_at desc);
create index if not exists album_jobs_status_idx on public.album_jobs(status, updated_at);
create index if not exists generations_job_created_idx on public.job_generations(job_id, created_at);
create index if not exists generations_user_status_idx on public.job_generations(user_id, status, created_at desc);
create index if not exists generations_queue_idx on public.job_generations(kind, status, created_at);
create index if not exists usage_job_idx on public.usage_events(job_id, created_at desc);
create index if not exists leases_expiry_idx on public.worker_leases(expires_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists album_jobs_set_updated_at on public.album_jobs;
create trigger album_jobs_set_updated_at before update on public.album_jobs
for each row execute function public.set_updated_at();
drop trigger if exists generations_set_updated_at on public.job_generations;
create trigger generations_set_updated_at before update on public.job_generations
for each row execute function public.set_updated_at();

alter table public.album_jobs enable row level security;
alter table public.job_generations enable row level security;
alter table public.usage_events enable row level security;
alter table public.worker_leases enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists "owners read album jobs" on public.album_jobs;
create policy "owners read album jobs" on public.album_jobs for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "owners read generations" on public.job_generations;
create policy "owners read generations" on public.job_generations for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "owners read usage" on public.usage_events;
create policy "owners read usage" on public.usage_events for select to authenticated
using ((select auth.uid()) = user_id);
-- No client insert/update/delete policies. APIs and workers use guarded SECURITY DEFINER RPCs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album-art', 'album-art', false, 20971520, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owners read album art" on storage.objects;
create policy "owners read album art" on storage.objects for select to authenticated
using (bucket_id = 'album-art' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Uploads/deletes are service-role only. Every key begins with the owner's UUID.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'album_jobs'
  ) then alter publication supabase_realtime add table public.album_jobs; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_generations'
  ) then alter publication supabase_realtime add table public.job_generations; end if;
end $$;

do $$ begin perform pgmq.create('mood_generation'); exception when duplicate_table then null; when unique_violation then null; end $$;
do $$ begin perform pgmq.create('final_generation'); exception when duplicate_table then null; when unique_violation then null; end $$;
do $$ begin perform pgmq.create('upscale_generation'); exception when duplicate_table then null; when unique_violation then null; end $$;

create or replace function public.assert_rate_limit(
  p_subject_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' or p_subject_id is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_window_seconds not between 1 and 86400 then raise exception 'invalid_rate_limit'; end if;
  insert into public.rate_limits(subject_id, action, window_started_at, request_count)
  values (p_subject_id, p_action, now(), 1)
  on conflict (subject_id, action) do update set
    window_started_at = case when public.rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then now() else public.rate_limits.window_started_at end,
    request_count = case when public.rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then 1 else public.rate_limits.request_count + 1 end,
    updated_at = now()
  returning request_count into v_count;
  if v_count > p_limit then raise exception 'rate_limit_exceeded' using errcode = 'P0001'; end if;
  return v_count;
end;
$$;

create or replace function public.api_create_job(
  p_user_id uuid, p_prompt text, p_model text, p_resolution text, p_rate_limit integer default 10
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := p_user_id; v_job uuid; v_generation uuid; v_slot integer;
  v_modifiers text[] := array[
    'dark, atmospheric, high contrast, cinematic lighting, dramatic depth',
    'bright, vibrant, kinetic energy, bold complementary color palette',
    'minimalist abstraction, geometric composition, generous negative space',
    'retro analog artwork, tactile print texture, film grain, timeless typography-free design'
  ];
  v_seeds bigint[] := array[104729, 130363, 155921, 180749];
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  p_prompt := btrim(p_prompt);
  if char_length(p_prompt) not between 3 and 2000 then raise exception 'invalid_prompt'; end if;
  perform public.assert_rate_limit(v_uid, 'create_job', p_rate_limit, 3600);
  insert into public.album_jobs(user_id, prompt) values (v_uid, p_prompt) returning id into v_job;
  for v_slot in 0..3 loop
    insert into public.job_generations(
      job_id, user_id, kind, mood_round, mood_slot, prompt, modifier, seed, model, resolution
    ) values (
      v_job, v_uid, 'mood', 1, v_slot,
      p_prompt || E'\n\nCreative direction: ' || v_modifiers[v_slot + 1] ||
        '. Create album-cover artwork only; no text or logos. Portrait 3:4 composition.',
      v_modifiers[v_slot + 1], v_seeds[v_slot + 1], p_model, p_resolution
    ) returning id into v_generation;
    perform pgmq.send('mood_generation', jsonb_build_object('generation_id', v_generation, 'job_id', v_job));
  end loop;
  return v_job;
end;
$$;

create or replace function public.api_regenerate_moods(
  p_user_id uuid, p_job_id uuid, p_model text, p_resolution text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := p_user_id; v_job public.album_jobs; v_round integer; v_generation uuid; v_slot integer;
  v_modifiers text[] := array[
    'dark, atmospheric, high contrast, cinematic lighting, dramatic depth',
    'bright, vibrant, kinetic energy, bold complementary color palette',
    'minimalist abstraction, geometric composition, generous negative space',
    'retro analog artwork, tactile print texture, film grain, timeless typography-free design'
  ];
  v_seeds bigint[] := array[324503, 350377, 376127, 401771];
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select * into v_job from public.album_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.status in ('pending_final','pending_upscale','cancelled') then raise exception 'invalid_job_state'; end if;
  v_round := v_job.mood_round + 1;
  update public.album_jobs set mood_round = v_round, status = 'pending_moods',
    selected_generation_id = null, current_generation_id = null, error_code = null, error_message = null
  where id = p_job_id;
  for v_slot in 0..3 loop
    insert into public.job_generations(
      job_id, user_id, kind, mood_round, mood_slot, prompt, modifier, seed, model, resolution
    ) values (
      p_job_id, v_uid, 'mood', v_round, v_slot,
      v_job.prompt || E'\n\nCreative direction: ' || v_modifiers[v_slot + 1] ||
        '. Create album-cover artwork only; no text or logos. Portrait 3:4 composition.',
      v_modifiers[v_slot + 1], v_seeds[v_slot + 1] + v_round * 1009, p_model, p_resolution
    ) returning id into v_generation;
    perform pgmq.send('mood_generation', jsonb_build_object('generation_id', v_generation, 'job_id', p_job_id));
  end loop;
  return v_round;
end;
$$;

create or replace function public.api_select_mood(
  p_user_id uuid, p_job_id uuid, p_generation_id uuid, p_model text, p_resolution text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := p_user_id; v_job public.album_jobs; v_mood public.job_generations; v_generation uuid;
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select * into v_job from public.album_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  select * into v_mood from public.job_generations where id = p_generation_id and job_id = p_job_id
    and user_id = v_uid and kind = 'mood' and status = 'complete' and mood_round = v_job.mood_round;
  if not found then raise exception 'mood_not_ready'; end if;
  insert into public.job_generations(job_id,user_id,kind,prompt,model,resolution,source_generation_id)
  values (p_job_id,v_uid,'final',v_job.prompt || E'\n\nDevelop the reference into polished, production-ready album artwork. No text or logos.',
    p_model,p_resolution,p_generation_id) returning id into v_generation;
  update public.album_jobs set selected_generation_id = p_generation_id, current_generation_id = v_generation,
    status = 'pending_final', error_code = null, error_message = null where id = p_job_id;
  perform pgmq.send('final_generation', jsonb_build_object('generation_id',v_generation,'job_id',p_job_id));
  return v_generation;
end;
$$;

create or replace function public.api_request_changes(
  p_user_id uuid, p_job_id uuid, p_changes text, p_model text, p_resolution text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := p_user_id; v_job public.album_jobs; v_source public.job_generations; v_generation uuid;
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  p_changes := btrim(p_changes);
  if char_length(p_changes) not between 3 and 1000 then raise exception 'invalid_changes'; end if;
  select * into v_job from public.album_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.status not in ('final_ready','complete') then raise exception 'invalid_job_state'; end if;
  select * into v_source from public.job_generations where id = v_job.current_generation_id
    and status = 'complete' and object_path is not null;
  if not found then raise exception 'source_not_ready'; end if;
  insert into public.job_generations(job_id,user_id,kind,prompt,model,resolution,source_generation_id)
  values (p_job_id,v_uid,'revision',v_job.prompt || E'\n\nApply these changes while preserving the reference composition: ' ||
    p_changes || '. No text or logos.',p_model,p_resolution,v_source.id) returning id into v_generation;
  update public.album_jobs set current_generation_id=v_generation,status='pending_final',
    error_code=null,error_message=null where id=p_job_id;
  perform pgmq.send('final_generation',jsonb_build_object('generation_id',v_generation,'job_id',p_job_id));
  return v_generation;
end;
$$;

create or replace function public.api_request_upscale(
  p_user_id uuid, p_job_id uuid, p_model text, p_resolution text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := p_user_id; v_job public.album_jobs; v_source public.job_generations; v_generation uuid;
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select * into v_job from public.album_jobs where id=p_job_id and user_id=v_uid for update;
  if not found then raise exception 'job_not_found' using errcode='P0002'; end if;
  if v_job.status not in ('final_ready','complete') then raise exception 'invalid_job_state'; end if;
  select * into v_source from public.job_generations where id=v_job.current_generation_id
    and status='complete' and object_path is not null;
  if not found then raise exception 'source_not_ready'; end if;
  insert into public.job_generations(job_id,user_id,kind,prompt,model,resolution,source_generation_id)
  values (p_job_id,v_uid,'upscale',v_source.prompt || E'\n\nUpscale and refine details without changing composition.',
    p_model,p_resolution,v_source.id) returning id into v_generation;
  update public.album_jobs set current_generation_id=v_generation,status='pending_upscale',
    error_code=null,error_message=null where id=p_job_id;
  perform pgmq.send('upscale_generation',jsonb_build_object('generation_id',v_generation,'job_id',p_job_id));
  return v_generation;
end;
$$;

create or replace function public.api_cancel_job(p_user_id uuid, p_job_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := p_user_id;
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  update public.album_jobs set status='cancelled',cancelled_at=now()
  where id=p_job_id and user_id=v_uid and status in ('pending_moods','moods_ready','pending_final','pending_upscale');
  if not found then return false; end if;
  update public.job_generations set status='cancelled'
  where job_id=p_job_id and status in ('queued','retrying');
  return true;
end;
$$;

create or replace function public.acquire_generation_lease(
  p_worker_id text, p_generation_id uuid, p_queue_name text,
  p_max_slots integer, p_ttl_seconds integer
) returns table(slot_no integer, lease_token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_slot integer; v_token uuid := extensions.gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_max_slots not between 1 and 100 or p_ttl_seconds not between 10 and 900 then raise exception 'invalid_lease_config'; end if;
  insert into public.worker_leases(slot_no) select generate_series(1,p_max_slots) on conflict do nothing;
  select wl.slot_no into v_slot from public.worker_leases wl
  where wl.slot_no <= p_max_slots and (wl.lease_token is null or wl.expires_at <= now())
  order by wl.slot_no for update skip locked limit 1;
  if v_slot is null then return; end if;
  update public.worker_leases wl set lease_token=v_token,worker_id=p_worker_id,generation_id=p_generation_id,
    queue_name=p_queue_name,acquired_at=now(),expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()
  where wl.slot_no=v_slot;
  return query select v_slot,v_token,now()+make_interval(secs=>p_ttl_seconds);
end;
$$;

create or replace function public.release_generation_lease(p_slot_no integer,p_lease_token uuid)
returns boolean language sql security definer set search_path = '' as $$
  update public.worker_leases set lease_token=null,worker_id=null,generation_id=null,queue_name=null,
    acquired_at=null,expires_at=null,updated_at=now()
  where slot_no=p_slot_no and lease_token=p_lease_token and auth.role()='service_role'
  returning true;
$$;

create or replace function public.worker_claim_generation(p_generation_id uuid,p_stale_seconds integer)
returns setof public.job_generations
language sql security definer set search_path = '' as $$
  update public.job_generations set status='processing',attempts=attempts+1,processing_started_at=now(),last_error=null
  where id=p_generation_id and auth.role()='service_role' and (
    status in ('queued','retrying') or
    (status='processing' and processing_started_at < now()-make_interval(secs=>p_stale_seconds))
  )
  returning *;
$$;

create or replace function public.worker_complete_generation(
  p_generation_id uuid,p_object_path text,p_mime_type text,p_width integer,p_height integer,
  p_request_id text default null,p_cost_usd numeric default null,p_usage jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_gen public.job_generations; v_job public.album_jobs;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.job_generations set status='complete',object_path=p_object_path,mime_type=p_mime_type,
    width=p_width,height=p_height,completed_at=now(),processing_started_at=null
  where id=p_generation_id and status='processing' returning * into v_gen;
  if not found then return false; end if;
  insert into public.usage_events(user_id,job_id,generation_id,model,request_id,cost_usd,metadata)
  values(v_gen.user_id,v_gen.job_id,v_gen.id,v_gen.model,p_request_id,p_cost_usd,coalesce(p_usage,'{}'::jsonb));
  select * into v_job from public.album_jobs where id=v_gen.job_id for update;
  if v_job.status='cancelled' then return true; end if;
  if v_gen.kind='mood' then
    if not exists(select 1 from public.job_generations where job_id=v_gen.job_id and kind='mood'
      and mood_round=v_gen.mood_round and status not in ('complete','failed','cancelled')) then
      update public.album_jobs set status=case when exists(select 1 from public.job_generations
        where job_id=v_gen.job_id and kind='mood' and mood_round=v_gen.mood_round and status='complete')
        then 'moods_ready'::public.album_job_status else 'failed'::public.album_job_status end
      where id=v_gen.job_id;
    end if;
  elsif v_gen.kind in ('final','revision') then
    update public.album_jobs set status='final_ready',current_generation_id=v_gen.id where id=v_gen.job_id;
  else
    update public.album_jobs set status='complete',current_generation_id=v_gen.id where id=v_gen.job_id;
  end if;
  return true;
end;
$$;

create or replace function public.worker_fail_generation(
  p_generation_id uuid,p_error text,p_max_attempts integer
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_gen public.job_generations; v_terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into v_gen from public.job_generations where id=p_generation_id for update;
  if not found or v_gen.status='complete' then return 'ignored'; end if;
  v_terminal := v_gen.attempts >= p_max_attempts;
  update public.job_generations set status=case when v_terminal then 'failed'::public.generation_status
    else 'retrying'::public.generation_status end,last_error=left(p_error,1000),processing_started_at=null
  where id=p_generation_id;
  if v_terminal then
    if v_gen.kind='mood' then
      if not exists(select 1 from public.job_generations where job_id=v_gen.job_id and kind='mood'
        and mood_round=v_gen.mood_round and status not in ('complete','failed','cancelled')) then
        update public.album_jobs set status=case when exists(select 1 from public.job_generations
          where job_id=v_gen.job_id and kind='mood' and mood_round=v_gen.mood_round and status='complete')
          then 'moods_ready'::public.album_job_status else 'failed'::public.album_job_status end,
          error_code='generation_failed',error_message='One or more generations failed' where id=v_gen.job_id;
      end if;
    else
      update public.album_jobs set status='failed',error_code='generation_failed',
        error_message='Image generation failed after retries' where id=v_gen.job_id and status<>'cancelled';
    end if;
    return 'failed';
  end if;
  return 'retrying';
end;
$$;

create or replace function public.queue_read(p_queue text,p_visibility integer,p_quantity integer)
returns table(msg_id bigint,read_ct integer,enqueued_at timestamptz,vt timestamptz,message jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_queue not in ('mood_generation','final_generation','upscale_generation') then raise exception 'invalid_queue'; end if;
  return query select r.msg_id,r.read_ct,r.enqueued_at,r.vt,r.message from pgmq.read(p_queue,p_visibility,p_quantity) as r;
end;
$$;

create or replace function public.queue_delete(p_queue text,p_msg_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()<>'service_role' or p_queue not in ('mood_generation','final_generation','upscale_generation')
    then raise exception 'invalid_queue_access' using errcode='42501'; end if;
  return pgmq.delete(p_queue,p_msg_id);
end;
$$;

create or replace function public.queue_archive(p_queue text,p_msg_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()<>'service_role' or p_queue not in ('mood_generation','final_generation','upscale_generation')
    then raise exception 'invalid_queue_access' using errcode='42501'; end if;
  return pgmq.archive(p_queue,p_msg_id);
end;
$$;

create or replace function public.queue_set_visibility(
  p_queue text,p_msg_id bigint,p_visibility integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role()<>'service_role' or p_queue not in ('mood_generation','final_generation','upscale_generation')
    then raise exception 'invalid_queue_access' using errcode='42501'; end if;
  if p_visibility not between 1 and 900 then raise exception 'invalid_visibility'; end if;
  perform pgmq.set_vt(p_queue,p_msg_id,p_visibility);
  return true;
end;
$$;

create or replace function public.cleanup_unused_anonymous_users(p_older_than_days integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_deleted integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_older_than_days not between 7 and 3650 then raise exception 'invalid_retention'; end if;
  select array_agg(u.id) into v_ids
  from auth.users u
  where u.is_anonymous is true
    and u.created_at < now() - make_interval(days => p_older_than_days)
    and not exists (select 1 from public.album_jobs j where j.user_id = u.id);
  delete from public.rate_limits
  where updated_at < now() - make_interval(days => p_older_than_days);
  if coalesce(array_length(v_ids, 1), 0) = 0 then return 0; end if;
  delete from public.rate_limits where subject_id = any(v_ids);
  delete from auth.users where id = any(v_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.album_jobs,public.job_generations,public.usage_events to authenticated;
revoke all on function public.assert_rate_limit(uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function public.api_create_job(uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.api_regenerate_moods(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.api_select_mood(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.api_request_changes(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.api_request_upscale(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.api_cancel_job(uuid,uuid) from public,anon,authenticated;

revoke all on function public.acquire_generation_lease(text,uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function public.release_generation_lease(integer,uuid) from public,anon,authenticated;
revoke all on function public.worker_claim_generation(uuid,integer) from public,anon,authenticated;
revoke all on function public.worker_complete_generation(uuid,text,text,integer,integer,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.worker_fail_generation(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.queue_read(text,integer,integer) from public,anon,authenticated;
revoke all on function public.queue_delete(text,bigint) from public,anon,authenticated;
revoke all on function public.queue_archive(text,bigint) from public,anon,authenticated;
revoke all on function public.queue_set_visibility(text,bigint,integer) from public,anon,authenticated;
revoke all on function public.cleanup_unused_anonymous_users(integer) from public,anon,authenticated;
grant execute on all functions in schema public to service_role;

-- Cron is intentionally not scheduled here: configure Vault secrets first, then use the
-- documented templates in supabase/README.md. No deployment credentials belong in migrations.
