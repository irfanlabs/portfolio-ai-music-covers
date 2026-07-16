import { z } from 'zod'

const browserEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_ENABLE_TURNSTILE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  VITE_TURNSTILE_SITE_KEY: z.string().optional(),
})

const parsed = browserEnvSchema.safeParse(import.meta.env)

if (!parsed.success) {
  console.error(
    'Invalid browser environment',
    parsed.error.flatten().fieldErrors,
  )
}

export const env = parsed.success
  ? parsed.data
  : {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'missing-local-key',
      VITE_ENABLE_TURNSTILE: false,
      VITE_TURNSTILE_SITE_KEY: undefined,
    }

export const hasValidSupabaseEnv = parsed.success
