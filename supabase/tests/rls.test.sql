begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'visitor-a@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'visitor-b@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.album_jobs (id, user_id, prompt) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Visitor A private artwork'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'Visitor B private artwork'
  );

insert into public.job_generations (
  id, job_id, user_id, kind, mood_round, mood_slot, prompt, modifier,
  seed, model, resolution
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'mood', 1, 0, 'Private mood direction', 'cinematic', 42,
  'google/gemini-2.5-flash-image', '1K'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.api_create_job(uuid,text,text,text,integer)',
    'execute'
  ),
  'authenticated clients cannot bypass the create-job Edge Function'
);

select is(
  (select public from storage.buckets where id = 'album-art'),
  false,
  'album artwork bucket is private'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('album_jobs', 'job_generations')
  ),
  2,
  'job tables are published for Realtime'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.album_jobs),
  1::bigint,
  'visitor A sees exactly one owned job'
);
select is(
  (
    select count(*)
    from public.album_jobs
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  0::bigint,
  'visitor A cannot read visitor B job'
);
select throws_ok(
  $$
    insert into public.album_jobs (user_id, prompt)
    values ('11111111-1111-4111-8111-111111111111', 'Direct mutation')
  $$,
  '42501',
  null,
  'visitors cannot mutate jobs directly'
);
select throws_ok(
  $$
    select public.api_cancel_job(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  $$,
  '42501',
  null,
  'visitors cannot invoke internal workflow RPCs'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
select is(
  (
    select count(*)
    from public.album_jobs
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  0::bigint,
  'visitor B cannot read visitor A job'
);

reset role;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role"}',
  true
);
select is(
  (
    select count(*)
    from public.acquire_generation_lease(
      'test-worker',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'mood_generation',
      1,
      60
    )
  ),
  1::bigint,
  'a service worker atomically acquires an available global slot'
);
select is(
  (
    select count(*)
    from public.acquire_generation_lease(
      'second-worker',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'mood_generation',
      1,
      60
    )
  ),
  0::bigint,
  'global concurrency ceiling rejects a second lease'
);

select * from finish();
rollback;
