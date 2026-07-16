import { useQuery } from '@tanstack/react-query'
import { ImageOff, LoaderCircle } from 'lucide-react'
import { getSignedImage } from '../lib/api'
import { cn } from '../lib/utils'

export function GenerationImage({
  jobId,
  generationId,
  alt,
  className,
}: {
  jobId: string
  generationId: string
  alt: string
  className?: string
}) {
  const image = useQuery({
    queryKey: ['signed-image', jobId, generationId],
    queryFn: () => getSignedImage(jobId, generationId),
    // Backend TTL is configurable down to 30 seconds.
    staleTime: 20_000,
    retry: 1,
  })

  if (image.isPending) {
    return (
      <div
        className={cn(
          'image-shimmer grid place-items-center bg-paper-100',
          className,
        )}
      >
        <LoaderCircle className="size-5 animate-spin text-ink-500" />
      </div>
    )
  }

  if (!image.data?.signedUrl) {
    return (
      <div
        className={cn(
          'grid place-items-center bg-paper-100 text-ink-500',
          className,
        )}
      >
        <ImageOff className="size-5" />
      </div>
    )
  }

  return (
    <img
      className={cn('bg-paper-100 object-cover', className)}
      src={image.data.signedUrl}
      alt={alt}
    />
  )
}
