# AI Image Studio — Build Plan

Album cover generation tool for music artists/studios. React/Vite frontend, Supabase (Postgres + Edge Functions + Storage + Realtime + pgmq queues) backend, OpenRouter for image generation.

This doc is the source of truth for Cursor while scaffolding the project. Follow phases in order — each phase should be independently testable before moving to the next.

---

## 0. Product Summary

**Flow:**

1. User enters an image prompt.
2. System generates 4 "mood" images (cheap/fast model) — user picks one or regenerates.
3. Selected mood → final high-quality image (premium model), 3:4 aspect ratio.
4. User can request an upscale, or request changes (iterate on the final image).
5. Realtime updates push status/images to frontend as jobs complete — no polling.

**Non-negotiables:**

- All output images are 3:4 aspect ratio.
- Mood images must vary meaningfully from each other (vary prompt/seed/style per slot, not just re-run same prompt 4x).
- User never blocks on a synchronous long-running request — everything goes through a queue.

---

## 1. Tech Stack

- **Frontend:** React + Vite, TypeScript, Tailwind, Supabase JS client (Realtime subscriptions + Storage)
- **Backend:** Supabase Edge Functions (Deno), Postgres, `pgmq` extension for queues, `pg_cron` for scheduled queue processing
- **Image generation:** OpenRouter Image API (`/api/v1/images/models/{model}/endpoints`)
  - Mood tier: `bytedance-seed/seedream-4.5` ($0.05/image flat, fast)
  - Final tier: `google/gemini-3-pro-image` a.k.a. Nano Banana Pro (best quality, native 2K/4K, strong prompt adherence, image-to-image support)
  - Upscale: reuse Nano Banana Pro at higher resolution using the final image as reference before considering a dedicated upscaler
- **Storage:** Supabase Storage (bucket per environment, path-namespaced per user/job)
- **Auth:** Supabase Auth (email or OAuth — confirm with product before Phase 1)

---

## 2. Environment Variables

Create `.env.local` (frontend) and Supabase project secrets (backend). Never commit real keys.

```
# Frontend (.env.local)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Supabase Edge Function secrets (set via `supabase secrets set`)
OPENROUTER_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # for Edge Functions that need elevated DB/storage access
SUPABASE_URL=
```

---

## 3. Database Schema

### 3.1 Enable extensions

```sql
create extension if not exists pgmq;
create extension if not exists pg_cron;
```

### 3.2 Core table

```sql
create type job_status as enum (
  'pending_moods',
  'moods_ready',
  'pending_final',
  'final_ready',
  'pending_upscale',
  'done',
  'failed'
);

create table album_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  prompt text not null,
  status job_status not null default 'pending_moods',

  mood_images jsonb not null default '[]'::jsonb,
  -- [{ "index": 0, "url": null, "status": "pending", "model": "bytedance-seed/seedream-4.5", "seed": 1234 }, ...]

  selected_mood_index int,
  final_image_url text,
  final_image_prompt text,       -- prompt used for the final gen (may differ from original if "request changes" was used)
  upscaled_image_url text,

  error text,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on album_jobs (user_id);
create index on album_jobs (status);

-- keep updated_at fresh
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger album_jobs_updated_at
  before update on album_jobs
  for each row execute function set_updated_at();
```

### 3.3 Row Level Security

```sql
alter table album_jobs enable row level security;

create policy "users read own jobs"
  on album_jobs for select
  using (auth.uid() = user_id);

create policy "users insert own jobs"
  on album_jobs for insert
  with check (auth.uid() = user_id);

-- No update/delete policy for regular users — only service_role (Edge Functions) can mutate job state.
```

### 3.4 Queues

```sql
select pgmq.create('mood_gen_queue');
select pgmq.create('final_gen_queue');
select pgmq.create('upscale_queue');
```

Message payload shape (JSON):

```jsonc
// mood_gen_queue
{ "job_id": "uuid", "mood_index": 0, "prompt": "...", "seed": 1234, "style_hint": "moody/dark" }

// final_gen_queue
{ "job_id": "uuid", "reference_image_url": "...", "prompt": "..." }

// upscale_queue
{ "job_id": "uuid", "source_image_url": "..." }
```

### 3.5 Realtime

Enable Realtime on `album_jobs` (publication `supabase_realtime`) so the frontend can subscribe to row changes filtered by `id`.

---

## 4. Edge Functions

All under `supabase/functions/`. Use service-role client for DB writes inside queue processors; use anon/user JWT for client-facing functions.

### 4.1 `create-job` (client-facing, JWT required)

- Input: `{ prompt: string }`
- Validate prompt (length, basic moderation pass — flag for review, don't block silently)
- Insert `album_jobs` row (`status = 'pending_moods'`), with 4 placeholder entries in `mood_images`
- Generate 4 _varied_ sub-prompts from the base prompt (see §6 Prompt Variation Strategy) — store per-slot prompt/seed in `mood_images`
- Enqueue 4 messages to `mood_gen_queue`
- Return `{ job_id }`

### 4.2 `regenerate-moods` (client-facing, JWT required)

- Input: `{ job_id }`
- Verify ownership (user_id match)
- Reset relevant `mood_images` slots to pending, bump a `mood_round` counter (add column if you want to cap free regenerations)
- Re-enqueue 4 new messages with new seeds/variation prompts

### 4.3 `select-mood` (client-facing, JWT required)

- Input: `{ job_id, mood_index }`
- Verify ownership + that mood_index has a completed image
- Set `selected_mood_index`, `status = 'pending_final'`
- Enqueue message to `final_gen_queue` with the selected mood image URL as reference

### 4.4 `request-changes` (client-facing, JWT required)

- Input: `{ job_id, change_prompt }`
- Verify ownership + `status = 'final_ready'`
- Set `status = 'pending_final'`
- Enqueue new message to `final_gen_queue` referencing the _current_ final image + the change instruction

### 4.5 `request-upscale` (client-facing, JWT required)

- Input: `{ job_id }`
- Verify ownership + `status = 'final_ready'`
- Set `status = 'pending_upscale'`
- Enqueue message to `upscale_queue`

### 4.6 `process-mood-queue` (cron-triggered, service role only)

- `pgmq.read('mood_gen_queue', vt, qty)` — batch size configurable (start with 8)
- For each message: call OpenRouter (Seedream 4.5), aspect_ratio=3:4
- On success: update the matching slot in `album_jobs.mood_images`, upload image to Storage, store Storage URL, `pgmq.delete()`
- On failure: increment retry_count; after N retries, mark slot `status: 'failed'` and `pgmq.archive()`
- After processing batch: for any job_id touched, check if all 4 mood slots are terminal (done or failed) → flip `status = 'moods_ready'` (or `'failed'` if all 4 failed)

### 4.7 `process-final-queue` (cron-triggered, service role only)

- `pgmq.read('final_gen_queue', vt, qty)`
- Call OpenRouter (Nano Banana Pro), pass reference image + prompt, aspect_ratio=3:4
- On success: upload to Storage, set `final_image_url`, `status = 'final_ready'`, `pgmq.delete()`
- On failure: retry logic same pattern as above, else `status = 'failed'`

### 4.8 `process-upscale-queue` (cron-triggered, service role only)

- `pgmq.read('upscale_queue', vt, qty)`
- Call OpenRouter (Nano Banana Pro at 2K/4K) using source image as reference
- On success: upload to Storage, set `upscaled_image_url`, `status = 'done'`, `pgmq.delete()`
- On failure: same retry pattern

### 4.9 Shared helpers (`supabase/functions/_shared/`)

- `openrouter.ts` — thin client wrapper for the Image API (model, prompt, aspect_ratio, reference image, provider pinning)
- `storage.ts` — upload base64/binary image to Storage bucket, return public/signed URL
- `db.ts` — service-role Supabase client factory
- `auth.ts` — extract + verify user JWT, check job ownership

---

## 5. pg_cron Schedule

```sql
select cron.schedule('process-mood-queue', '*/10 seconds', $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/process-mood-queue',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
  );
$$);

-- repeat for process-final-queue and process-upscale-queue,
-- final/upscale can run less frequently, e.g. every 15-20s, since volume is lower
```

Notes:

- `pg_cron` minimum granularity is 1 minute on some plans — confirm on your Supabase tier; if sub-minute isn't available, use a Supabase Cron Job (different feature) or an external scheduler hitting the Edge Function.
- Tune batch size (`qty` in `pgmq.read`) and interval together to stay under Edge Function timeout (keep total batch processing time comfortably under 60–90s to leave margin).
- Set `pgmq` visibility timeout (`vt`) longer than expected processing time per batch, so in-flight messages aren't picked up twice.

---

## 6. Prompt Variation Strategy (Mood Diversity)

The 4 mood images must differ meaningfully. Don't send the same prompt 4x with just a different seed — vary the _semantic_ framing too. In `create-job`, generate 4 sub-prompts by appending distinct style/mood modifiers to the base prompt, e.g.:

- Slot 0: base prompt + "dark, moody, high contrast, cinematic lighting"
- Slot 1: base prompt + "bright, vibrant, energetic color palette"
- Slot 2: base prompt + "minimalist, abstract, negative space"
- Slot 3: base prompt + "retro/vintage texture, film grain, analog feel"

This can start as a static rotation of 4 modifier sets, or later be generated dynamically via an LLM call (cheap text model) that reads the user's base prompt and proposes 4 divergent creative directions. Start static — upgrade later.

---

## 7. Frontend (React/Vite)

### 7.1 Pages/Views

- `NewJob` — prompt input, submit → navigate to `JobView`
- `JobView` — subscribes to `album_jobs:id=eq.<job_id>` via Realtime
  - Renders mood grid (4 slots, loading skeleton per slot until image lands)
  - "Regenerate moods" button
  - On mood select → shows final image loading state → final image
  - "Upscale" and "Request changes" actions once final is ready
  - Download button for final/upscaled image

### 7.2 Realtime subscription pattern

```ts
supabase
  .channel(`album_job_${jobId}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'album_jobs',
      filter: `id=eq.${jobId}`,
    },
    (payload) => setJob(payload.new),
  )
  .subscribe()
```

### 7.3 Components

- `PromptInput`
- `MoodGrid` + `MoodCard` (loading / ready / failed states)
- `FinalImagePanel` (loading / ready states, download + upscale + request-changes actions)
- `JobStatusBadge`

---

## 8. Build Order (Phases)

**Phase 1 — Foundation**

- [ ] Supabase project setup, enable `pgmq` + `pg_cron`
- [ ] Schema migration (§3), RLS policies
- [ ] Storage bucket setup + policies
- [ ] Auth wired up (frontend + Edge Function JWT verification)

**Phase 2 — Mood generation happy path**

- [ ] `create-job` Edge Function
- [ ] `process-mood-queue` Edge Function + OpenRouter wrapper
- [ ] pg_cron schedule for mood queue
- [ ] Frontend: `NewJob` + `JobView` with Realtime, mood grid rendering
- [ ] Manual test: submit prompt → see 4 moods populate progressively

**Phase 3 — Mood selection + final generation**

- [ ] `select-mood`, `process-final-queue`
- [ ] pg_cron schedule for final queue
- [ ] Frontend: selection UI → final image loading → final image display
- [ ] Manual test: full path prompt → moods → select → final image

**Phase 4 — Upscale + iteration**

- [ ] `request-upscale`, `process-upscale-queue`
- [ ] `request-changes`
- [ ] Frontend: upscale button, request-changes input, download button
- [ ] Manual test: full path including upscale and one change-request round-trip

**Phase 5 — Regeneration, retries, hardening**

- [ ] `regenerate-moods` + optional cap on free regenerations
- [ ] Retry logic + failure states across all queue processors
- [ ] Error surfacing in UI (per-mood-slot failure, job-level failure)
- [ ] Basic cost/usage logging (log OpenRouter cost per job for later billing/credits work)

**Phase 6 — Polish**

- [ ] Rate limiting on `create-job` (per-user)
- [ ] Prompt moderation pass
- [ ] Loading skeletons, empty states, error toasts
- [ ] Deploy checklist (see §10)

---

## 9. Open Questions (resolve before/during Phase 1)

- Auth method: email/password, magic link, or OAuth (Google)?
- Do mood regenerations count against a credit/quota system, or unlimited for now (MVP)?
- Storage bucket: public URLs or signed URLs with expiry? (Signed URLs safer for a paid product.)
- Is there a moderation requirement for prompts (explicit content, copyrighted artist names, etc.)?
- Confirm current OpenRouter model slugs/pricing at implementation time — model catalog and pricing shift; re-check `openrouter.ai/models?output_modalities=image` before wiring the client.

---

## 10. Deploy Checklist

- [ ] All secrets set via `supabase secrets set`, none committed
- [ ] RLS confirmed on all tables (test with a non-owner JWT)
- [ ] pg_cron jobs confirmed running (`select * from cron.job;` / `cron.job_run_details`)
- [ ] pgmq queue depth monitored (alert if backlog grows unbounded — signals worker throughput issue)
- [ ] Storage bucket size/cost monitoring
- [ ] OpenRouter spend alerting (per-job cost logging from Phase 5 feeds this)
