import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { AppShell } from './components/app-shell'
import { useAuth } from './components/auth-provider'
import { Button, StudioMark } from './components/ui'

const Dashboard = lazy(() =>
  import('./pages/dashboard').then((module) => ({
    default: module.Dashboard,
  })),
)
const JobWorkspace = lazy(() =>
  import('./pages/job-workspace').then((module) => ({
    default: module.JobWorkspace,
  })),
)

export function App() {
  const auth = useAuth()

  if (!auth.isReady) {
    return (
      <div className="studio-grid grid min-h-screen place-items-center bg-paper-50">
        <div className="text-center">
          <StudioMark />
          <LoaderCircle className="mx-auto mt-8 size-5 animate-spin text-ink-500" />
          <p className="mt-3 text-xs font-medium text-ink-500">
            Preparing your private workspace
          </p>
        </div>
      </div>
    )
  }

  if (auth.error || !auth.session) {
    return (
      <div className="studio-grid grid min-h-screen place-items-center bg-paper-50 p-5">
        <div className="w-full max-w-md rounded-3xl border border-ink-950/8 bg-white p-8 text-center shadow-studio">
          <span className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">
            Workspace could not start
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-500">{auth.error}</p>
          <Button className="mt-6" onClick={auth.retry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="grid min-h-[70vh] place-items-center">
          <LoaderCircle className="size-5 animate-spin text-ink-500" />
        </div>
      }
    >
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="jobs/:jobId" element={<JobWorkspace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
