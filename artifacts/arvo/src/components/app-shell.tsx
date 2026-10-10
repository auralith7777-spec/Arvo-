import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, ArrowUpRight, CircleHelp, Command, Inbox, LogOut, Settings2 } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.reload();
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const health = useHealthCheck();
  const healthy = health.data?.status === 'ok' || health.isSuccess;

  return (
    <div className="arvo-shell flex">
      <aside className="sidebar hidden w-[244px] shrink-0 flex-col justify-between px-4 py-6 md:flex">
        <div>
          <Link href="/" className="mb-10 flex items-center gap-3 px-2 text-inherit no-underline" data-testid="link-arvo-home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f0ca63] text-[#263342]">
              <Command size={19} strokeWidth={2.4} />
            </span>
            <span className="font-[Manrope] text-[20px] font-extrabold tracking-[-0.06em]">arvo<span className="text-[#f0ca63]">.</span></span>
          </Link>
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#94a0ac]">Workspace</p>
          <nav className="space-y-1">
            <Link href="/" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold no-underline transition-colors ${location === '/' ? 'bg-[#344354] text-[#fffaf0]' : 'text-[#b5bec7] hover:bg-[#2a3949] hover:text-white'}`} data-testid="link-dashboard">
              <Activity size={17} /> Recovery desk
            </Link>
            <Link href="/inbox" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold no-underline transition-colors ${location === '/inbox' ? 'bg-[#344354] text-[#fffaf0]' : 'text-[#b5bec7] hover:bg-[#2a3949] hover:text-white'}`} data-testid="link-inbox">
              <Inbox size={17} /> Inbox
            </Link>
            <Link href="/settings" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold no-underline transition-colors ${location === '/settings' ? 'bg-[#344354] text-[#fffaf0]' : 'text-[#b5bec7] hover:bg-[#2a3949] hover:text-white'}`} data-testid="link-settings">
              <Settings2 size={17} /> Settings
            </Link>
          </nav>
        </div>
        <div>
          <div className="mb-4 rounded-xl border border-[#394757] bg-[#273544] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#e7ebef]">
              <span className={`h-2 w-2 rounded-full ${healthy ? 'bg-[#7eb69b]' : health.isLoading ? 'bg-[#e3bd60]' : 'bg-[#d48378]'}`} />
              {health.isLoading ? 'Connecting to Arvo' : healthy ? 'API service online' : 'Connection needs attention'}
            </div>
            <p className="m-0 text-[11px] leading-relaxed text-[#9ba7b3]">Daily checks run while the API service is available. Integration setup is shown in Settings.</p>
          </div>
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[#aeb8c2] hover:bg-[#2a3949]" onClick={() => health.refetch()} data-testid="button-health-refresh">
            <CircleHelp size={15} /> Help & system status <ArrowUpRight size={13} className="ml-auto" />
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[#aeb8c2] hover:bg-[#2a3949]" onClick={handleLogout} data-testid="button-logout">
            <LogOut size={15} /> Sign out
          </button>
          <div className="mt-4 border-t border-[#394757] px-2 pt-4 text-[10px] text-[#778594]">ARVO RECOVERY WORKSPACE <span className="float-right mono">v0.1</span></div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-[62px] items-center justify-between border-b border-[#e6e0d5] bg-[#faf8f2] px-5 md:hidden">
          <Link href="/" className="font-[Manrope] text-xl font-extrabold tracking-[-.06em] text-[#283342] no-underline">arvo<span className="text-[#c99c31]">.</span></Link>
          <nav className="flex gap-4 text-xs font-semibold">
            <Link href="/" className="text-[#344e68] no-underline">Recovery</Link>
            <Link href="/inbox" className="text-[#687584] no-underline">Inbox</Link>
            <Link href="/settings" className="text-[#687584] no-underline">Settings</Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-7 lg:px-10 lg:pt-9">{children}</main>
      </div>
    </div>
  );
}