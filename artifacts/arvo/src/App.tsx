import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppShell from '@/components/app-shell';
import DashboardPage from '@/pages/dashboard';
import SettingsPage from '@/pages/settings';
import InboxPage from '@/pages/inbox';
import NotFound from '@/pages/not-found';
import LoginPage from '@/pages/login';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

function useAuthGate() {
  const [state, setState] = useState<AuthState>('checking');

  async function check() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const body = await res.json();
      setState(body.authenticated ? 'authenticated' : 'unauthenticated');
    } catch {
      setState('unauthenticated');
    }
  }

  useEffect(() => {
    check();
  }, []);

  return { state, recheck: check };
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <AppShell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppShell>
  );
}

function AuthGate() {
  const { state, recheck } = useAuthGate();

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1b242e] text-sm text-[#9ba7b3]">
        Loading…
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return <LoginPage onSuccess={recheck} />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Router />
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;