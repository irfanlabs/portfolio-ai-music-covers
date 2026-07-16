import { useEffect, useRef } from 'react'
import { env } from '../lib/env'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          theme: 'light'
          size: 'flexible'
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        },
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

export function Turnstile({
  onToken,
}: {
  onToken: (token: string | undefined) => void
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (
      !env.VITE_ENABLE_TURNSTILE ||
      !env.VITE_TURNSTILE_SITE_KEY ||
      !container.current
    ) {
      return
    }

    let widgetId: string | undefined
    const render = () => {
      if (!window.turnstile || !container.current || widgetId) return
      widgetId = window.turnstile.render(container.current, {
        sitekey: env.VITE_TURNSTILE_SITE_KEY!,
        theme: 'light',
        size: 'flexible',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(undefined),
        'error-callback': () => onToken(undefined),
      })
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-form-studio-turnstile]',
    )
    if (existing) {
      if (window.turnstile) render()
      else existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.formStudioTurnstile = 'true'
      script.addEventListener('load', render, { once: true })
      document.head.appendChild(script)
    }

    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [onToken])

  if (!env.VITE_ENABLE_TURNSTILE) return null

  return (
    <div className="mt-4">
      <div ref={container} className="min-h-[65px] w-full" />
    </div>
  )
}
