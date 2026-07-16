# Form Studio

Form Studio is a production-oriented AI album-cover workspace. A visitor enters
one creative brief, receives four distinct mood directions, selects one, and
continues to a final, revision, or high-resolution render. Generation happens
asynchronously through Supabase Queues and the UI follows progress through
Realtime.

## Stack

- React 19, Vite, TypeScript, Tailwind CSS
- TanStack Query, React Router, Radix primitives
- Supabase Auth, Postgres, Realtime, Storage, Edge Functions, Queues and Cron
- OpenRouter Images API

## Local setup

Requirements: Node.js 22+, Docker, and the Supabase CLI.

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Start Supabase with `supabase start`.
4. Use the local API URL and publishable key printed by the CLI in `.env.local`.
5. Add Edge Function secrets to `supabase/.env.local`; at minimum set
   `OPENROUTER_API_KEY`. Never expose this key through a `VITE_` variable.
6. Serve functions with
   `supabase functions serve --env-file supabase/.env.local`.
7. Start the frontend with `npm run dev`.

Anonymous sign-ins must be enabled. There is intentionally no login screen:
Supabase creates a private anonymous session on first load and stores it in the
browser. Clearing browser data creates a new identity; previous projects cannot
be recovered without a future account-linking feature.

## Useful commands

- `npm run typecheck` — strict TypeScript checks
- `npm run lint` — lint frontend and tooling
- `npm test` — unit tests
- `npm run test:e2e` — mocked browser workflow
- `npm run build` — production build
- `supabase db reset` — rebuild the local database from migrations

## Production configuration

Set browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the
frontend host. Set all generation and queue settings from `.env.example` as
Supabase Edge Function secrets. The most important capacity control is
`MAX_CONCURRENT_GENERATIONS`; database leases enforce this ceiling across
overlapping function invocations. Batch sizes only control how much each queue
processor attempts to claim.

The image bucket is private. Database rows store object paths and the
`get-signed-image` function issues short-lived URLs only after checking job
ownership.

For scheduled workers, run `supabase db push` then execute
`supabase/scripts/setup-vault-secrets.sql` in the SQL Editor (see
`supabase/README.md`). Without this step, mood/final/upscale jobs remain queued
forever. Keep OpenRouter spend alerts, queue-depth checks, failed-message
archives, and stale lease cleanup enabled before opening production traffic.

## Deployment gate

Before release:

1. Run `npm run typecheck && npm run lint && npm test && npm run build`.
2. Test RLS with two separate anonymous browser sessions.
3. Confirm neither session can query, subscribe to, sign, or download the other
   session's objects.
4. Confirm all models return 3:4 images and current model slugs remain available.
5. Confirm queue visibility and lease durations exceed expected provider latency.
6. Enable Turnstile and tune anonymous/IP rate limits for public traffic.
