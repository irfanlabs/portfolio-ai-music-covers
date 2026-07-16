import { expect, test, type Page } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const token =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6MTk5OTk5OTk5OX0.test'

async function mockStudioApi(page: Page) {
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.endsWith('/auth/v1/signup')) {
      return route.fulfill({
        json: {
          access_token: token,
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'test-refresh',
          user: {
            id: userId,
            aud: 'authenticated',
            role: 'authenticated',
            is_anonymous: true,
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        },
      })
    }

    if (url.pathname.endsWith('/rest/v1/album_jobs')) {
      const isSingle = url.searchParams.has('id')
      return route.fulfill({
        headers: isSingle
          ? { 'content-type': 'application/vnd.pgrst.object+json' }
          : { 'content-type': 'application/json', 'content-range': '0-0/0' },
        body: JSON.stringify(
          isSingle
            ? {
                id: jobId,
                user_id: userId,
                prompt: 'A nocturnal city reflected in rain',
                status: 'moods_ready',
                mood_round: 1,
                selected_generation_id: null,
                current_generation_id: null,
                error_code: null,
                error_message: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
            : [],
        ),
      })
    }

    if (url.pathname.endsWith('/rest/v1/job_generations')) {
      return route.fulfill({
        json: [0, 1, 2, 3].map((slot) => ({
          id: `33333333-3333-4333-8333-33333333333${slot}`,
          job_id: jobId,
          user_id: userId,
          kind: 'mood',
          mood_slot: slot,
          mood_round: 1,
          status: 'complete',
          prompt: `Direction ${slot}`,
          model: 'google/gemini-2.5-flash-image',
          object_path: `${userId}/${jobId}/${slot}.png`,
          mime_type: 'image/png',
          last_error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      })
    }

    if (url.pathname.endsWith('/functions/v1/create-job')) {
      return route.fulfill({ json: { job_id: jobId } })
    }

    if (url.pathname.endsWith('/functions/v1/get-signed-image')) {
      return route.fulfill({
        json: {
          generation_id: 'image',
          url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="800"%3E%3Crect width="100%25" height="100%25" fill="%231b2027"/%3E%3C/svg%3E',
          expires_in: 900,
        },
      })
    }

    return route.fulfill({ json: {} })
  })
}

test('creates a brief and displays four directions', async ({ page }) => {
  await mockStudioApi(page)
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Artwork with a point of view.' }),
  ).toBeVisible()
  await page
    .getByLabel('Describe your album artwork')
    .fill('A nocturnal city reflected in rain')
  await page.getByRole('button', { name: /Create directions/ }).click()

  await expect(page).toHaveURL(`/jobs/${jobId}`)
  await expect(
    page.getByRole('heading', { name: 'Creative directions' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Cinematic depth/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Analog memory/ }),
  ).toBeVisible()
})
