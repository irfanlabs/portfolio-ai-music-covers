import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, StudioMark } from './ui'

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled studio error', { error, info })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="studio-grid grid min-h-screen place-items-center p-5">
        <div className="w-full max-w-md rounded-3xl border border-ink-950/8 bg-white p-8 text-center shadow-studio">
          <div className="mb-7 flex justify-center">
            <StudioMark />
          </div>
          <span className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-red-50 text-red-700">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">
            The studio hit an unexpected issue
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            Your background work is safe. Reload to reconnect to the project.
          </p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Reload studio
          </Button>
        </div>
      </div>
    )
  }
}
