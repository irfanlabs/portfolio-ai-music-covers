import { useCallback, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowRight,
  Clock3,
  Layers3,
  ShieldCheck,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { createJob, deleteJob, listJobs } from '../lib/api'
import type { AlbumJob } from '../lib/types'
import { getErrorMessage, formatRelativeDate } from '../lib/utils'
import { Button, Card, SectionLabel, StatusBadge } from '../components/ui'
import { Turnstile } from '../components/turnstile'
import { env } from '../lib/env'

const examplePrompts = [
  'Nocturnal city lights reflected in rain, alt-R&B single',
  'Desert sunrise with surreal chrome forms, cinematic and minimal',
  'Raw punk collage in black, cream and signal red',
]

export function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<AlbumJob | null>(null)
  const handleTurnstile = useCallback(
    (token: string | undefined) => setTurnstileToken(token),
    [],
  )
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: listJobs })
  const create = useMutation({
    mutationFn: () => createJob(prompt.trim(), turnstileToken),
    onSuccess: ({ job_id: jobId }) => {
      toast.success('Creative directions are now in production.')
      void navigate(`/jobs/${jobId}`)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: (jobId: string) => deleteJob(jobId),
    onSuccess: () => {
      toast.success('Project deleted.')
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (prompt.trim().length < 8) {
      toast.error('Add a little more creative direction first.')
      return
    }
    if (env.VITE_ENABLE_TURNSTILE && !turnstileToken) {
      toast.error('Complete the verification before creating artwork.')
      return
    }
    create.mutate()
  }

  return (
    <>
      <section className="studio-grid border-b border-ink-950/8">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 lg:grid-cols-[0.82fr_1.18fr] lg:px-8 lg:py-24">
          <div className="max-w-xl self-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ink-950/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm">
              <span className="size-1.5 rounded-full bg-accent-500" />
              AI artwork direction for music teams
            </div>
            <h1 className="max-w-[640px] text-5xl leading-[0.98] font-semibold tracking-[-0.055em] text-ink-950 sm:text-6xl lg:text-7xl">
              Artwork with a point of view.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-ink-500 sm:text-lg">
              Describe the world around your release. We will shape four
              distinct visual directions, then finish the one that feels right.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-ink-500">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-ink-900" /> Private
                workspace
              </span>
              <span className="flex items-center gap-2">
                <Layers3 className="size-4 text-ink-900" /> Four directions
              </span>
              <span className="flex items-center gap-2">
                <Clock3 className="size-4 text-ink-900" /> Live progress
              </span>
            </div>
          </div>

          <Card
            id="create"
            className="relative overflow-hidden p-5 shadow-studio sm:p-8"
          >
            <div className="absolute top-0 right-0 h-40 w-40 translate-x-1/3 -translate-y-1/3 rounded-full bg-accent-400/40 blur-3xl" />
            <div className="relative">
              <SectionLabel>New creative brief</SectionLabel>
              <form onSubmit={submit}>
                <label htmlFor="prompt" className="sr-only">
                  Describe your album artwork
                </label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={1200}
                  rows={7}
                  className="focus-ring w-full resize-none rounded-2xl border border-ink-950/10 bg-paper-50 p-5 text-lg leading-7 font-medium tracking-[-0.01em] text-ink-950 placeholder:text-ink-500/65"
                  placeholder="Describe the subject, atmosphere, palette, typography or references you have in mind…"
                />
                <Turnstile onToken={handleTurnstile} />
                <div className="mt-4 flex items-center justify-between gap-4">
                  <span className="text-xs text-ink-500">
                    {prompt.length}/1,200
                  </span>
                  <Button
                    type="submit"
                    isLoading={create.isPending}
                    className="min-w-44"
                  >
                    Create directions
                    {!create.isPending ? (
                      <ArrowRight className="size-4" />
                    ) : null}
                  </Button>
                </div>
              </form>
              <div className="mt-7 border-t border-ink-950/8 pt-5">
                <p className="mb-3 text-xs font-semibold text-ink-500">
                  Start with an example
                </p>
                <div className="flex flex-wrap gap-2">
                  {examplePrompts.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setPrompt(example)}
                      className="focus-ring rounded-full border border-ink-950/8 bg-white px-3 py-2 text-left text-xs font-medium text-ink-700 transition hover:border-ink-950/20 hover:bg-paper-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-14 lg:px-8 lg:py-20">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <SectionLabel>Your workspace</SectionLabel>
            <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink-950">
              Recent projects
            </h2>
          </div>
          <span className="text-xs font-medium text-ink-500">
            {jobs.data?.length ?? 0} projects
          </span>
        </div>

        {jobs.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="image-shimmer h-52 rounded-3xl border border-ink-950/8"
              />
            ))}
          </div>
        ) : jobs.data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.data.map((job, index) => (
              <div
                key={job.id}
                className="group relative overflow-hidden rounded-3xl border border-ink-950/8 bg-white text-left transition hover:-translate-y-0.5 hover:border-ink-950/18 hover:shadow-xl hover:shadow-ink-950/6"
              >
                <button
                  type="button"
                  onClick={() => void navigate(`/jobs/${job.id}`)}
                  className="focus-ring block w-full text-left"
                >
                  <div
                    className={`h-24 ${
                      index % 3 === 0
                        ? 'bg-[linear-gradient(135deg,#14181e,#425060)]'
                        : index % 3 === 1
                          ? 'bg-[linear-gradient(135deg,#b9f16f,#315a4b)]'
                          : 'bg-[linear-gradient(135deg,#f0d5c2,#954c55)]'
                    }`}
                  />
                  <div className="p-5 pb-14">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <StatusBadge status={job.status} />
                      <span className="text-[11px] font-medium text-ink-500">
                        {formatRelativeDate(job.updated_at)}
                      </span>
                    </div>
                    <p className="line-clamp-2 min-h-11 text-sm leading-5 font-semibold text-ink-900">
                      {job.prompt}
                    </p>
                    <span className="mt-5 flex items-center gap-2 text-xs font-bold text-ink-500 transition group-hover:text-ink-950">
                      Open project <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`Delete project: ${job.prompt}`}
                  onClick={() => setDeleteTarget(job)}
                  className="focus-ring absolute right-4 bottom-4 grid size-9 place-items-center rounded-full border border-ink-950/8 bg-white text-ink-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Card className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-paper-100 text-ink-700">
                <WandSparkles className="size-5" />
              </span>
              <h3 className="font-semibold text-ink-950">
                Your first project starts above
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-ink-500">
                Add a creative brief and your four visual directions will appear
                here.
              </p>
            </div>
          </Card>
        )}
      </section>

      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold tracking-tight text-ink-950">
                  Delete project?
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-ink-500">
                  This will permanently remove the project and all generated
                  artwork. This action cannot be undone.
                </Dialog.Description>
              </div>
              <Dialog.Close
                disabled={remove.isPending}
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-paper-100 text-ink-500 hover:text-ink-950 disabled:opacity-50"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {deleteTarget ? (
              <p className="mb-6 line-clamp-2 rounded-2xl bg-paper-50 px-4 py-3 text-sm font-medium text-ink-900">
                {deleteTarget.prompt}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={remove.isPending}
                onClick={() => {
                  if (deleteTarget) remove.mutate(deleteTarget.id)
                }}
              >
                Delete project
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
