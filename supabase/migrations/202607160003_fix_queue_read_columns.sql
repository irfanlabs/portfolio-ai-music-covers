-- pgmq >= 1.10.0 added `last_read_at` and `headers` columns to
-- pgmq.message_record. `queue_read` previously did `select * from pgmq.read(...)`
-- which now returns more columns than the declared `returns table(...)`,
-- causing "structure of query does not match function result type" (42804)
-- on every call. Select explicit columns so this stays stable regardless of
-- what pgmq adds to message_record in the future.

create or replace function public.queue_read(p_queue text, p_visibility integer, p_quantity integer)
returns table(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_queue not in ('mood_generation', 'final_generation', 'upscale_generation') then raise exception 'invalid_queue'; end if;
  return query
    select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
    from pgmq.read(p_queue, p_visibility, p_quantity) as r;
end;
$$;

revoke all on function public.queue_read(text, integer, integer) from public, anon, authenticated;
