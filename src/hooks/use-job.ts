import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getJob } from '../lib/api'
import { supabase } from '../lib/supabase'

export function useJob(jobId: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId),
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    }

    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'album_jobs',
          filter: `id=eq.${jobId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_generations',
          filter: `job_id=eq.${jobId}`,
        },
        refresh,
      )
      .subscribe()

    const reconnect = () => {
      if (navigator.onLine) refresh()
    }
    window.addEventListener('online', reconnect)

    return () => {
      window.removeEventListener('online', reconnect)
      void supabase.removeChannel(channel)
    }
  }, [jobId, queryClient])

  return query
}
