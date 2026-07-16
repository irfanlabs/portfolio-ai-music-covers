import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import { Toaster } from 'sonner'
import { App } from './app'
import { AuthProvider } from './components/auth-provider'
import { ErrorBoundary } from './components/error-boundary'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnReconnect: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ErrorBoundary>
            <AuthProvider>
              <App />
              <Toaster
                position="bottom-right"
                toastOptions={{
                  className: 'font-sans',
                }}
              />
            </AuthProvider>
          </ErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
