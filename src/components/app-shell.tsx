import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CircleHelp, LayoutGrid, Plus } from 'lucide-react'
import { StudioMark } from './ui'
import { cn } from '../lib/utils'

export function AppShell() {
  const location = useLocation()
  const isJob = location.pathname.startsWith('/jobs/')

  return (
    <div className="grain min-h-screen bg-paper-50 text-ink-900">
      <header className="sticky top-0 z-40 border-b border-ink-950/8 bg-paper-50/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 lg:px-8">
          <Link className="focus-ring rounded-xl" to="/">
            <StudioMark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            <NavLink
              to="/"
              className={({ isActive }) =>
                cn(
                  'focus-ring flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition',
                  isActive && !isJob
                    ? 'bg-ink-950 text-white'
                    : 'text-ink-500 hover:bg-white hover:text-ink-950',
                )
              }
            >
              <LayoutGrid className="size-4" />
              <span className="hidden sm:inline">Studio</span>
            </NavLink>
            <Link
              to="/#create"
              className="focus-ring flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink-500 transition hover:bg-white hover:text-ink-950"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">New artwork</span>
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs font-medium text-ink-500 md:flex">
              <span className="size-2 rounded-full bg-emerald-500" />
              Studio online
            </span>
            <button
              type="button"
              aria-label="About this studio"
              className="focus-ring grid size-10 place-items-center rounded-full text-ink-500 hover:bg-white hover:text-ink-950"
              title="Your work is private to this browser session."
            >
              <CircleHelp className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-ink-950/8 px-5 py-8 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p>Form Studio — focused tools for independent music teams.</p>
        <p>Your projects stay private to this browser.</p>
      </footer>
    </div>
  )
}
