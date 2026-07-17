# AI Image Studio backend

This directory contains the complete Supabase backend. Anonymous users are authenticated by Supabase Auth, but all writes go through Edge Functions and atomic database RPCs. Generated images remain in the private `album-art` bucket and database rows store object paths only.

## Local setup

Prerequisites: Docker, Supabase CLI, and Deno.

```sh
supabase start
supabase db reset
supabase secrets set OPENROUTER_API_KEY=...
supabase functions serve --env-file supabase/.env.local
deno task --config supabase/functions/deno.json test
```

The frontend must call `signInAnonymously()` and send the resulting access token as `Authorization: Bearer <jwt>` to every client-facing function. Function-level gateway JWT verification is disabled because anonymous JWT compatibility can differ between legacy and asymmetric keys; each handler always validates the token with `auth.getUser()` before doing any work.

Do not commit `supabase/.env.local`. Local function secrets:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
OPENROUTER_API_KEY=<secret>
OPENROUTER_HTTP_REFERER=http://localhost:5173

MOOD_IMAGE_MODEL=google/gemini-2.5-flash-image
FINAL_IMAGE_MODEL=google/gemini-3-pro-image
MOOD_IMAGE_RESOLUTION=1K
FINAL_IMAGE_RESOLUTION=2K
UPSCALE_IMAGE_RESOLUTION=4K
TURNSTILE_SECRET_KEY=<optional-secret-for-public-traffic>

MAX_CONCURRENT_GENERATIONS=8
MOOD_WORKER_BATCH_SIZE=4
FINAL_WORKER_BATCH_SIZE=2
UPSCALE_WORKER_BATCH_SIZE=1
QUEUE_VISIBILITY_TIMEOUT_SECONDS=180
GENERATION_LEASE_SECONDS=240
MAX_RETRIES=3
SIGNED_URL_TTL_SECONDS=300
CREATE_JOB_RATE_LIMIT_PER_HOUR=10
CREATE_JOB_IP_RATE_LIMIT_PER_HOUR=30
```

All numeric settings are bounded in code. Creation is limited independently by
anonymous identity and a one-way hash of the forwarded client IP; enabling
Turnstile adds a further abuse check without retaining the raw IP. Keep the
queue visibility timeout shorter than or equal to the lease duration, and keep
the lease duration above the expected provider request time.
`MAX_CONCURRENT_GENERATIONS` is enforced by atomic expiring rows in
`worker_leases`; it applies across simultaneous invocations of every worker,
across every queue (mood/final/upscale) and every job, since the lease pool
is global rather than partitioned. Keep it comfortably above the largest
worker batch size (`MOOD_WORKER_BATCH_SIZE` by default) so a single job's
batch never saturates the entire pool and starve unrelated work of a slot.

## Client API

All functions accept `POST` JSON and require a user JWT.

- `create-job`: `{ "prompt": "..." }`
- `regenerate-moods`: `{ "job_id": "uuid" }`
- `select-mood`: `{ "job_id": "uuid", "generation_id": "uuid" }` (or `mood_index: 0..3`)
- `request-changes`: `{ "job_id": "uuid", "changes": "..." }` (`change_prompt` is also accepted)
- `request-upscale`: `{ "job_id": "uuid" }`
- `cancel-job`: `{ "job_id": "uuid" }`
- `get-signed-image`: `{ "job_id": "uuid", "generation_id": "uuid" }`

Creation and transition RPCs lock the job row and enqueue within the same transaction. The four mood records use fixed semantic directions and deterministic per-round seeds. Every provider request uses a 3:4 aspect ratio.

Only `album_jobs`, `job_generations`, and `usage_events` are selectable by clients, with ownership enforced by RLS. There are no direct client mutation policies. Storage keys have the form:

```text
<auth-user-id>/<job-id>/<generation-id>.<extension>
```

The signed-image function checks both row ownership and that prefix before creating a short-lived URL.

## Workers and retries

Workers require the service-role bearer token:

- `process-mood-queue` reads `mood_generation`
- `process-final-queue` reads `final_generation`
- `process-upscale-queue` reads `upscale_generation`

Each worker reads a bounded batch, atomically acquires a global lease slot, idempotently claims the generation, calls OpenRouter's `POST /api/v1/images/generations`, uploads bytes, records cost when returned, and completes the state transition transactionally. Failed messages get exponential visibility backoff and are archived after `MAX_RETRIES`. Expired leases and stale processing claims can be recovered without pooled advisory locks.

The OpenRouter adapter sends `model`, `prompt`, `aspect_ratio`, `resolution`, and `input_references`, and accepts either base64 or URL image responses. Confirm the configured model slugs and supported resolution strings against the live OpenRouter catalog before production deployment.

## Production cron (fallback safety net)

Queue workers are **woken immediately** when a client API enqueues work
(`create-job`, `select-mood`, etc.). Cron is only a backup for retries and
missed wakes.

Migration `202607160002_schedule_worker_cron.sql` installs
`schedule_studio_worker_cron()` and runs workers every **30 seconds** when
Vault secrets exist.

### One-time hosted setup

```sh
# 1. Apply migrations (includes the scheduler function)
supabase db push

# 2. Deploy edge functions if you have not already
supabase functions deploy
```

Then in **Supabase Dashboard → SQL Editor**:

1. Open `supabase/scripts/setup-vault-secrets.sql`
2. Replace `PASTE_YOUR_SERVICE_ROLE_KEY_HERE` with your service role key
3. Run the entire script

This stores Vault secrets and registers three fallback cron jobs (every 30s):

- `studio-process-moods` → `process-mood-queue`
- `studio-process-finals` → `process-final-queue`
- `studio-process-upscales` → `process-upscale-queue`

### Verify cron is running

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'studio-process-%';

select status, return_message, start_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname like 'studio-process-%')
order by start_time desc
limit 20;
```

If jobs fail with auth errors, re-run the Vault setup script with the correct
service role key. Inspect HTTP responses with `net._http_response` when your plan
allows it.

Schedule `select public.cleanup_unused_anonymous_users(30);` with a
service-role database context for periodic housekeeping. It only removes old
anonymous identities that have no projects, so it cannot orphan generated
artwork. Project/image retention should be implemented as a separate,
explicit product policy.

## Deployment checks

1. Run `supabase db reset` against a disposable/local database.
2. Run `deno task --config supabase/functions/deno.json check` and `test`.
3. Deploy migrations, then all functions.
4. Set secrets with `supabase secrets set`; never expose the service role or OpenRouter key to the browser.
5. Enable anonymous sign-ins in the hosted project's Auth settings.
6. Configure Vault and cron manually.
7. Verify two anonymous users cannot read each other's rows, subscribe to each other's changes, or sign each other's object paths.
8. Exercise mood, final, revision, upscale, retry, cancellation, and stale-lease recovery paths.
