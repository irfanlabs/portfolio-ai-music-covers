-- Allow owners to permanently delete a project and its related rows.
create or replace function public.api_delete_job(p_user_id uuid, p_job_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := p_user_id;
begin
  if auth.role() <> 'service_role' or v_uid is null then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.album_jobs where id = p_job_id and user_id = v_uid
  ) then
    return false;
  end if;
  update public.job_generations set status = 'cancelled'
  where job_id = p_job_id and status in ('queued', 'retrying');
  update public.album_jobs
  set selected_generation_id = null, current_generation_id = null
  where id = p_job_id and user_id = v_uid;
  delete from public.album_jobs where id = p_job_id and user_id = v_uid;
  return true;
end;
$$;

revoke all on function public.api_delete_job(uuid, uuid) from public, anon, authenticated;
