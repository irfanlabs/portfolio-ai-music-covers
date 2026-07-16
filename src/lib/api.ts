import { supabase } from './supabase'
import type { AlbumJob, JobGeneration, SignedImage } from './types'

async function invoke<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body,
  })
  if (error) {
    const context =
      'context' in error && error.context instanceof Response
        ? await error.context
            .clone()
            .json()
            .catch(() => null)
        : null
    const serverMessage =
      context &&
      typeof context === 'object' &&
      'error' in context &&
      context.error &&
      typeof context.error === 'object' &&
      'message' in context.error &&
      typeof context.error.message === 'string'
        ? context.error.message
        : null
    throw new Error(serverMessage ?? error.message)
  }
  if (!data) throw new Error('The server returned an empty response.')
  return data
}

export async function listJobs() {
  const { data, error } = await supabase
    .from('album_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) throw error
  return data as AlbumJob[]
}

export async function getJob(jobId: string) {
  const [jobResult, generationsResult] = await Promise.all([
    supabase.from('album_jobs').select('*').eq('id', jobId).single(),
    supabase
      .from('job_generations')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at'),
  ])
  if (jobResult.error) throw jobResult.error
  if (generationsResult.error) throw generationsResult.error
  return {
    job: jobResult.data as AlbumJob,
    generations: generationsResult.data as JobGeneration[],
  }
}

export const createJob = (prompt: string, turnstileToken?: string) =>
  invoke<{ job_id: string }>('create-job', {
    prompt,
    turnstile_token: turnstileToken,
  })

export const regenerateMoods = (jobId: string) =>
  invoke<{ job_id: string }>('regenerate-moods', { job_id: jobId })

export const selectMood = (jobId: string, generationId: string) =>
  invoke<{ job_id: string }>('select-mood', {
    job_id: jobId,
    generation_id: generationId,
  })

export const requestChanges = (jobId: string, changePrompt: string) =>
  invoke<{ job_id: string }>('request-changes', {
    job_id: jobId,
    changes: changePrompt,
  })

export const requestUpscale = (jobId: string) =>
  invoke<{ job_id: string }>('request-upscale', { job_id: jobId })

export const getSignedImage = async (jobId: string, generationId: string) => {
  const result = await invoke<{
    generation_id: string
    url: string
    expires_in: number
  }>('get-signed-image', {
    job_id: jobId,
    generation_id: generationId,
  })
  return {
    generationId: result.generation_id,
    signedUrl: result.url,
    expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
  } satisfies SignedImage
}
