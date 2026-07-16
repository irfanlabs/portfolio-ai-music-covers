export type JobStatus =
  | 'pending_moods'
  | 'moods_ready'
  | 'pending_final'
  | 'final_ready'
  | 'pending_upscale'
  | 'complete'
  | 'failed'
  | 'cancelled'

export type GenerationKind = 'mood' | 'final' | 'revision' | 'upscale'
export type GenerationStatus =
  'queued' | 'processing' | 'complete' | 'retrying' | 'failed' | 'cancelled'

export interface AlbumJob {
  id: string
  user_id: string
  prompt: string
  status: JobStatus
  mood_round: number
  selected_generation_id: string | null
  current_generation_id: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface JobGeneration {
  id: string
  job_id: string
  user_id: string
  kind: GenerationKind
  mood_slot: number | null
  mood_round: number | null
  status: GenerationStatus
  prompt: string
  model: string
  object_path: string | null
  mime_type: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface SignedImage {
  generationId: string
  signedUrl: string
  expiresAt: string
}

export interface JobWithGenerations extends AlbumJob {
  generations: JobGeneration[]
}

export const isJobWorking = (status: JobStatus) =>
  status === 'pending_moods' ||
  status === 'pending_final' ||
  status === 'pending_upscale'
