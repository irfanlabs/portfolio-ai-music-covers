import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowLeft,
  Check,
  Download,
  ImageIcon,
  Maximize2,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getSignedImage,
  regenerateMoods,
  requestChanges,
  requestUpscale,
  selectMood,
} from '../lib/api'
import type { JobGeneration } from '../lib/types'
import { getErrorMessage } from '../lib/utils'
import { useJob } from '../hooks/use-job'
import { GenerationImage } from '../components/generation-image'
import { Button, Card, SectionLabel, StatusBadge } from '../components/ui'

const moodLabels = [
  ['Cinematic depth', 'Dark, directional and high contrast'],
  ['Electric color', 'Bright, energetic and expressive'],
  ['Quiet abstraction', 'Minimal, spatial and conceptual'],
  ['Analog memory', 'Textured, tactile and nostalgic'],
]

export function JobWorkspace() {
  const { jobId = '' } = useParams()
  const queryClient = useQueryClient()
  const project = useJob(jobId)
  const [changePrompt, setChangePrompt] = useState('')
  const [changesOpen, setChangesOpen] = useState(false)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['job', jobId] })

  const selection = useMutation({
    mutationFn: (generationId: string) => selectMood(jobId, generationId),
    onSuccess: () => {
      toast.success('Direction selected. Rendering final artwork.')
      void refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const regenerate = useMutation({
    mutationFn: () => regenerateMoods(jobId),
    onSuccess: () => {
      toast.success('A fresh set of directions is on the way.')
      void refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const upscale = useMutation({
    mutationFn: () => requestUpscale(jobId),
    onSuccess: () => {
      toast.success('High-resolution render started.')
      void refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const revision = useMutation({
    mutationFn: () => requestChanges(jobId, changePrompt.trim()),
    onSuccess: () => {
      setChangesOpen(false)
      setChangePrompt('')
      toast.success('Revision started with your notes.')
      void refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  const generations = useMemo(
    () => project.data?.generations ?? [],
    [project.data?.generations],
  )
  const moods = useMemo(() => {
    const allMoods = generations.filter((item) => item.kind === 'mood')
    const latestRound = Math.max(
      0,
      ...allMoods.map((item) => item.mood_round ?? 0),
    )
    return allMoods
      .filter((item) => item.mood_round === latestRound)
      .sort((a, b) => (a.mood_slot ?? 0) - (b.mood_slot ?? 0))
  }, [generations])
  const job = project.data?.job
  const finalImage = generations.find(
    (item) =>
      item.id === job?.current_generation_id && item.status === 'complete',
  )

  const download = async () => {
    if (!finalImage) return
    try {
      const image = await getSignedImage(jobId, finalImage.id)
      const response = await fetch(image.signedUrl)
      if (!response.ok) throw new Error('The artwork could not be downloaded.')
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      const extension =
        finalImage.mime_type === 'image/jpeg'
          ? 'jpg'
          : finalImage.mime_type === 'image/webp'
            ? 'webp'
            : 'png'
      link.download = `form-studio-${jobId}.${extension}`
      link.rel = 'noopener'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const submitRevision = (event: FormEvent) => {
    event.preventDefault()
    if (changePrompt.trim().length < 5) {
      toast.error('Describe the change you want to make.')
      return
    }
    revision.mutate()
  }

  if (project.isPending) return <WorkspaceSkeleton />
  if (project.isError || !job) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-950">
          Project unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-500">
          It may belong to another private workspace, or no longer exist.
        </p>
        <Link
          to="/"
          className="focus-ring mt-7 inline-flex rounded-full bg-ink-950 px-5 py-3 text-sm font-semibold text-white"
        >
          Return to studio
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8 lg:py-12">
      <div className="mb-10">
        <Link
          to="/"
          className="focus-ring mb-6 inline-flex items-center gap-2 rounded-full text-xs font-bold text-ink-500 hover:text-ink-950"
        >
          <ArrowLeft className="size-4" /> Back to workspace
        </Link>
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <SectionLabel>Creative project</SectionLabel>
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.035em] text-ink-950 sm:text-3xl">
              {job.prompt}
            </h1>
          </div>
          <StatusBadge status={job.status} />
        </div>
      </div>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,.92fr)]">
        <section aria-labelledby="directions-title">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <SectionLabel>Stage 01</SectionLabel>
              <h2
                id="directions-title"
                className="text-xl font-semibold tracking-[-0.025em] text-ink-950"
              >
                Creative directions
              </h2>
            </div>
            <Button
              variant="secondary"
              className="min-h-10 px-4"
              onClick={() => regenerate.mutate()}
              isLoading={regenerate.isPending}
              disabled={job.status === 'pending_final'}
            >
              <RefreshCw className="size-3.5" /> Regenerate
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-5">
            {[0, 1, 2, 3].map((slot) => {
              const mood = moods.find((item) => item.mood_slot === slot)
              return (
                <MoodCard
                  key={mood?.id ?? slot}
                  mood={mood}
                  slot={slot}
                  selected={job.selected_generation_id === mood?.id}
                  disabled={
                    selection.isPending ||
                    job.status === 'pending_final' ||
                    job.status === 'pending_upscale'
                  }
                  onSelect={() => mood && selection.mutate(mood.id)}
                />
              )
            })}
          </div>
        </section>

        <section className="xl:sticky xl:top-24" aria-labelledby="final-title">
          <div className="mb-5">
            <SectionLabel>Stage 02</SectionLabel>
            <h2
              id="final-title"
              className="text-xl font-semibold tracking-[-0.025em] text-ink-950"
            >
              Final artwork
            </h2>
          </div>
          <Card className="overflow-hidden">
            <div className="relative mx-auto aspect-[3/4] max-h-[690px] bg-ink-950">
              {finalImage ? (
                <GenerationImage
                  jobId={jobId}
                  generationId={finalImage.id}
                  alt="Final generated album artwork"
                  className="size-full"
                />
              ) : job.status === 'pending_final' ||
                job.status === 'pending_upscale' ? (
                <div className="image-shimmer grid size-full place-items-center">
                  <div className="max-w-xs px-8 text-center">
                    <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-white/80">
                      <Sparkles className="size-5 animate-pulse text-ink-900" />
                    </span>
                    <p className="font-semibold text-ink-900">
                      Rendering your artwork
                    </p>
                    <p className="mt-2 text-xs leading-5 text-ink-500">
                      You can leave this page. Progress will continue safely in
                      the background.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid size-full place-items-center bg-ink-900 text-center">
                  <div className="max-w-xs px-8">
                    <span className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent-400">
                      <ImageIcon className="size-5" />
                    </span>
                    <p className="font-semibold text-white">
                      Select a direction to continue
                    </p>
                    <p className="mt-2 text-xs leading-5 text-white/50">
                      We will develop it into a high-resolution final cover.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-ink-950/8 p-4 sm:p-5">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setChangesOpen(true)}
                  disabled={!finalImage || job.status === 'pending_upscale'}
                  className="flex-1"
                >
                  <SlidersHorizontal className="size-4" /> Request changes
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => upscale.mutate()}
                  isLoading={upscale.isPending}
                  disabled={!finalImage || finalImage.kind === 'upscale'}
                  className="flex-1"
                >
                  <Maximize2 className="size-4" /> Upscale
                </Button>
                <Button
                  onClick={() => void download()}
                  disabled={!finalImage}
                  aria-label="Download final artwork"
                  className="px-4"
                >
                  <Download className="size-4" />
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </div>

      <Dialog.Root open={changesOpen} onOpenChange={setChangesOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold tracking-tight text-ink-950">
                  Refine the artwork
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-ink-500">
                  Be specific about what should change and what should stay.
                </Dialog.Description>
              </div>
              <Dialog.Close className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-paper-100 text-ink-500 hover:text-ink-950">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <form onSubmit={submitRevision}>
              <textarea
                value={changePrompt}
                onChange={(event) => setChangePrompt(event.target.value)}
                maxLength={600}
                rows={5}
                autoFocus
                className="focus-ring w-full resize-none rounded-2xl border border-ink-950/10 bg-paper-50 p-4 text-sm leading-6 text-ink-950 placeholder:text-ink-500/70"
                placeholder="For example: keep the composition, make the palette colder and remove the text…"
              />
              <div className="mt-4 flex justify-end">
                <Button type="submit" isLoading={revision.isPending}>
                  Send revision <Send className="size-4" />
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function MoodCard({
  mood,
  slot,
  selected,
  disabled,
  onSelect,
}: {
  mood?: JobGeneration
  slot: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const [label, description] = moodLabels[slot] ?? ['Direction', 'Visual study']
  const ready = mood?.status === 'complete'
  const failed = mood?.status === 'failed'

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!ready || disabled}
      className={`focus-ring group overflow-hidden rounded-3xl border bg-white text-left transition ${
        selected
          ? 'border-ink-950 ring-2 ring-ink-950 ring-offset-2'
          : 'border-ink-950/8 hover:border-ink-950/25'
      }`}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-paper-100">
        {ready && mood ? (
          <GenerationImage
            jobId={mood.job_id}
            generationId={mood.id}
            alt={`${label} album artwork direction`}
            className="size-full transition duration-500 group-hover:scale-[1.02]"
          />
        ) : failed ? (
          <div className="grid size-full place-items-center px-4 text-center">
            <div>
              <X className="mx-auto mb-3 size-5 text-red-500" />
              <p className="text-xs font-semibold text-red-700">
                Direction failed
              </p>
            </div>
          </div>
        ) : (
          <div className="image-shimmer grid size-full place-items-center">
            <span className="text-[11px] font-bold tracking-[0.14em] text-ink-500 uppercase">
              In production
            </span>
          </div>
        )}
        {selected ? (
          <span className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-accent-400 text-ink-950 shadow-lg">
            <Check className="size-4" strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <p className="text-sm font-bold text-ink-900">{label}</p>
        <p className="mt-1 text-[11px] leading-4 text-ink-500">{description}</p>
      </div>
    </button>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-12 lg:px-8">
      <div className="image-shimmer mb-10 h-24 max-w-3xl rounded-3xl" />
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="grid grid-cols-2 gap-5">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="image-shimmer aspect-[3/4] rounded-3xl"
            />
          ))}
        </div>
        <div className="image-shimmer mx-auto aspect-[3/4] w-full max-w-lg rounded-3xl" />
      </div>
    </div>
  )
}
