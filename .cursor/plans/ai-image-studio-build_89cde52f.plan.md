---
name: ai-image-studio-build
overview: Build the AI album-cover studio from an empty repository as a production-oriented React/Vite and Supabase application, with silent anonymous identity, private visitor-scoped data, asynchronous image generation, and environment-controlled capacity. The implementation will preserve the 3:4 mood-to-final workflow while correcting the original plan’s security, model, API, and concurrency assumptions.
todos:
  - id: foundation
    content: Scaffold the typed React/Vite frontend, Supabase local project, tooling, environment validation, and documentation
    status: completed
  - id: identity-data
    content: Implement silent anonymous sessions, normalized schema, queues, private Storage, Realtime, and owner-scoped RLS
    status: completed
  - id: backend-pipeline
    content: Build client APIs, OpenRouter adapter, idempotent queue processors, retries, leases, and environment-controlled concurrency
    status: completed
  - id: frontend-studio
    content: Build the professional dashboard and realtime job workspace across all generation states
    status: completed
  - id: quality-hardening
    content: Add isolation, state-machine, worker, and E2E tests plus rate limiting, abuse controls, observability, and cleanup
    status: completed
  - id: delivery
    content: Validate each vertical slice and complete production deployment readiness checks
    status: completed
isProject: false
---

# AI Image Studio Implementation Plan

## Locked product and architecture decisions
- Use silent `supabase.auth.signInAnonymously()` on first load—there is no login/signup UI. Supabase persists the generated anonymous session locally, and `auth.uid()` provides secure ownership for RLS and Edge Functions. Clearing browser storage or switching devices creates a new identity and makes prior jobs unrecoverable.
- Use a private Storage bucket with short-lived signed URLs. Persist object paths, not expiring URLs, in the database; authorized reads return fresh signed URLs.
- Configure `google/gemini-2.5-flash-image` for the four low-cost mood concepts and `google/gemini-3-pro-image` (Nano Banana Pro) for final generation, revisions, and upscale. Keep both slugs environment-configurable and validate availability at startup/deploy time.
- Use OpenRouter’s current Images API contract (`model`, `prompt`, `aspect_ratio: "3:4"`, resolution, references), isolated behind a typed adapter so provider changes do not affect job logic.

## 1. Scaffold and development foundation
- Create a React/Vite TypeScript frontend with Tailwind, React Router, TanStack Query, Supabase JS, accessible headless UI primitives, Lucide icons, ESLint/Prettier, Vitest, and Playwright.
- Establish design tokens, typed environment validation, reusable API/error utilities, and local Supabase configuration in [`package.json`](package.json), [`src/`](src/), [`supabase/config.toml`](supabase/config.toml), [`.env.example`](.env.example), and [`README.md`](README.md).
- Document local setup, secret management, migration/reset commands, Edge Function serving, and deployment checks. Never expose OpenRouter or service-role secrets to the browser.

## 2. Secure anonymous identity and relational data model
- Bootstrap or restore the anonymous Supabase session before rendering data routes; show a recoverable initialization state, but no auth screen.
- Replace concurrency-prone mood JSON updates from [`plan (2).md`](plan%20%282%29.md) with normalized tables: `album_jobs`, `job_generations` (four mood slots plus final/revision/upscale attempts), `usage_events`, and `worker_leases`. Add enums, constraints, timestamps, retry metadata, model/cost fields, and indexes.
- Add migrations enabling `pgmq`, `pg_cron`, `pg_net`, and Realtime; create the generation queues and atomic RPCs for ownership-safe state transitions and worker-slot leasing.
- Apply RLS to every exposed table so anonymous users can select only rows where `user_id = auth.uid()`. Client mutations go through authenticated Edge Functions; service-role processing remains server-only. Private Storage policies mirror the same owner-scoped path convention.

## 3. Job API, queue workers, and capacity controls
- Implement authenticated client-facing functions for create job, regenerate moods, select mood, request changes, request upscale, signed-image access, and optional cancellation. Each function verifies the JWT, ownership, valid state transition, and bounded input before enqueueing idempotent work.
- Implement shared helpers under [`supabase/functions/_shared/`](supabase/functions/_shared/) for auth, schema validation, database access, OpenRouter, Storage, queue operations, logging, and consistent errors.
- Implement idempotent mood/final/upscale processors. Workers claim messages with a visibility timeout, claim a database-backed lease, call OpenRouter, upload output, record usage, transition state transactionally, and delete the message only after success. Expired leases and failed messages are retried with backoff, then archived/dead-lettered after the configured limit.
- Enforce a true project-wide concurrent image-request ceiling across overlapping Edge Function invocations with atomic expiring lease slots—not batch size alone. Add per-queue caps and prioritization so final/revision work is not starved by mood batches.
- Make operational behavior configurable with backend secrets such as `MAX_CONCURRENT_GENERATIONS`, `MOOD_WORKER_BATCH_SIZE`, `FINAL_WORKER_BATCH_SIZE`, `UPSCALE_WORKER_BATCH_SIZE`, `QUEUE_VISIBILITY_TIMEOUT_SECONDS`, `MAX_RETRIES`, worker intervals, model slugs, output resolutions, signed-URL TTL, prompt limits, and anonymous rate limits. Parse, bound, and log effective configuration at worker startup.
- Schedule workers through `pg_cron` + `pg_net`, keeping invocation credentials in Supabase Vault and preventing overlapping runs from exceeding leases.

## 4. Corporate-grade frontend experience
- Build a restrained, responsive studio shell with a professional neutral palette, strong typography, consistent spacing, accessible focus/contrast, top navigation, and clear system status—avoiding decorative dashboard clutter.
- Add a dashboard route with a polished prompt composer, example prompt chips, concise workflow guidance, and visitor-scoped recent jobs/history.
- Add a job workspace route with a four-card mood grid, progressive Realtime updates, explicit queued/generating/failed states, selection confirmation, final artwork stage, revision drawer, upscale action, and authenticated download flow.
- Add skeletons, empty states, retry affordances, toasts, offline/reconnect handling, route-level error boundaries, responsive layouts, keyboard interactions, reduced-motion support, and clear cost/time-neutral status copy.
- Subscribe to both job and generation rows, reconcile events into the query cache, and refetch on reconnect so dropped Realtime events cannot leave stale UI.

## 5. Quality, security, and operational hardening
- Add unit tests for state transitions, validation, prompt variation, config bounds, OpenRouter response parsing, lease acquisition/release, retries, and signed-path authorization.
- Add migration/RLS integration tests proving visitor A cannot list, read, mutate, sign, or subscribe to visitor B’s jobs/images. Test expired sessions, cleared local storage, leaked job IDs, and service-role separation.
- Add mocked end-to-end tests for prompt → four varied moods → select → final → revision/upscale → private download, including partial failures and refresh/reconnect recovery.
- Add per-anonymous-user and IP-aware rate limits, configurable Turnstile protection for abuse-prone creation endpoints, prompt length/content safety validation, structured request/job IDs, sanitized errors, usage/cost records, queue-depth queries, stale-lease cleanup, and anonymous-account retention cleanup.

## 6. Delivery sequence and acceptance gates
- Deliver in independently testable vertical slices: foundation/identity; create-job and moods; selection/final; revision/upscale/download; history/polish; hardening/deployment.
- At each gate, run typecheck, lint, unit/integration tests, and the relevant mocked E2E path before proceeding.
- Final acceptance requires all outputs to be 3:4; four semantically distinct mood directions; no long-running client request; strict cross-visitor database, Realtime, and Storage isolation; capacity changes through environment configuration; resilient retries without duplicate outputs; and a clean production build.

## Inputs needed when implementation begins
- Supabase project URL and publishable key for local frontend configuration.
- OpenRouter API key and a Supabase project with anonymous sign-ins enabled.
- Deployment target/domain when production deployment is requested. Development can begin with placeholders and mocked OpenRouter responses before those credentials are available.