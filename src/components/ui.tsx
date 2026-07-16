import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'
import type { JobStatus } from '../lib/types'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  isLoading?: boolean
}

export function Button({
  className,
  variant = 'primary',
  isLoading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition',
        variant === 'primary' &&
          'bg-ink-950 text-white hover:bg-ink-800 disabled:bg-ink-500',
        variant === 'secondary' &&
          'border border-ink-950/12 bg-white text-ink-900 hover:border-ink-950/30 hover:bg-paper-50',
        variant === 'ghost' &&
          'text-ink-700 hover:bg-ink-950/5 hover:text-ink-950',
        variant === 'danger' && 'bg-red-50 text-red-700 hover:bg-red-100',
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

export function StudioMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-ink-950 text-accent-400">
        <Sparkles className="size-4" strokeWidth={2.4} />
      </span>
      {!compact ? (
        <span className="text-[15px] font-bold tracking-[-0.02em] text-ink-950">
          Form Studio
        </span>
      ) : null}
    </span>
  )
}

const statusLabels: Record<JobStatus, string> = {
  pending_moods: 'Creating directions',
  moods_ready: 'Directions ready',
  pending_final: 'Rendering artwork',
  final_ready: 'Artwork ready',
  pending_upscale: 'Upscaling',
  complete: 'Complete',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const isWorking = status.startsWith('pending')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
        status === 'failed'
          ? 'bg-red-50 text-red-700'
          : status === 'complete' || status === 'final_ready'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-ink-950/5 text-ink-700',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'failed'
            ? 'bg-red-500'
            : status === 'complete' || status === 'final_ready'
              ? 'bg-emerald-500'
              : 'bg-ink-500',
          isWorking && 'animate-pulse',
        )}
      />
      {statusLabels[status]}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-bold tracking-[0.16em] text-ink-500 uppercase">
      {children}
    </p>
  )
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-ink-950/8 bg-white shadow-[0_1px_2px_rgba(10,12,15,0.03)]',
        className,
      )}
      {...props}
    />
  )
}
