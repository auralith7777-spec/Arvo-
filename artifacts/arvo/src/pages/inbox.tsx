import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Inbox as InboxIcon, Mail, RefreshCw, Sparkles, Star, X } from 'lucide-react';

type Status = { configured: boolean; connected: boolean; email: string | null };
type Category = 'reply_today' | 'can_wait' | 'fyi' | 'low_priority';
type Message = {
  id: number; fromAddress: string; fromName: string; subject: string; snippet: string;
  receivedAt: string; category: Category; isVip: boolean; reasoning: string;
  draftReply: string | null; gmailDraftId: string | null;
};

const GROUPS: Array<{ key: Category; label: string; tone: string }> = [
  { key: 'reply_today', label: 'Needs reply today', tone: 'bg-[#fbefeb] text-[#8a453b]' },
  { key: 'can_wait', label: 'Can wait', tone: 'bg-[#f5ecd9] text-[#8a6a2c]' },
  { key: 'fyi', label: 'FYI only', tone: 'bg-[#e4eee5] text-[#3c5f4b]' },
  { key: 'low_priority', label: 'Low priority', tone: 'bg-[#eceae4] text-[#6c7378]' },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/inbox${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  state_mismatch: 'The sign-in session expired. Try connecting again.',
  no_refresh_token: 'Google did not return a refresh token. Remove Arvo from your Google account permissions and reconnect.',
  exchange_failed: 'Could not finish connecting to Gmail. Check the server logs.',
};

export default function InboxPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [vips, setVips] = useState<string[]>([]);
  const [vipInput, setVipInput] = useState('');
  const [brief, setBrief] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sync' | 'brief' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>('/status');
      setStatus(s);
      if (s.connected) {
        const [m, v] = await Promise.all([api<Message[]>('/messages'), api<string[]>('/vips')]);
        setMessages(m);
        setVips(v);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the inbox.');
    }
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(OAUTH_ERRORS[code] ?? `Gmail connection failed (${code}).`);
    void load();
  }, [load]);

  const sync = async () => {
    setBusy('sync'); setError(null); setNotice(null);
    try {
      const r = await api<{ fetched: number; processed: number; drafts: number; failed: number }>('/sync', { method: 'POST' });
      setNotice(`Checked ${r.fetched} recent emails: ${r.processed} new, ${r.drafts} drafts saved to Gmail${r.failed ? `, ${r.failed} failed` : ''}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed.'); }
    finally { setBusy(null); }
  };

  const loadBrief = async () => {
    setBusy('brief'); setError(null);
    try { setBrief((await api<{ brief: string }>('/brief')).brief); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not build the brief.'); }
    finally { setBusy(null); }
  };

  const addVip = async (event: FormEvent) => {
    event.preventDefault();
    try { await api('/vips', { method: 'POST', body: JSON.stringify({ email: vipInput }) }); setVipInput(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add VIP.'); }
  };
  const removeVip = async (email: string) => { await api('/vips', { method: 'DELETE', body: JSON.stringify({ email }) }); await load(); };
  const disconnect = async () => { await api('/disconnect', { method: 'POST' }); setMessages([]); setBrief(null); await load(); };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#9b8045]">Chief of Staff</span>
        <h1 className="mb-0 mt-1 font-[Manrope] text-[28px] font-bold tracking-[-.04em] text-[#283342]">Inbox</h1>
        <p className="mb-0 mt-1 text-sm text-[#7b8288]">Arvo reads your recent email, sorts it by urgency, and saves reply drafts in Gmail. Nothing is ever sent for you.</p>
      </div>
      {status?.connected && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="button-secondary" onClick={loadBrief} disabled={busy !== null}><Sparkles size={14} /> {busy === 'brief' ? 'Writing…' : 'Morning brief'}</button>
        <button type="button" className="button-primary" onClick={sync} disabled={busy !== null} data-testid="button-inbox-sync"><RefreshCw size={14} /> {busy === 'sync' ? 'Triaging…' : 'Sync inbox'}</button>
      </div>}
    </header>

    {error && <p className="m-0 rounded-lg bg-[#fbefeb] px-4 py-3 text-sm text-[#8a453b]" role="alert">{error}</p>}
    {notice && <p className="m-0 rounded-lg bg-[#e4eee5] px-4 py-3 text-sm text-[#3c5f4b]">{notice}</p>}

    {status && !status.configured && <div className="rounded-xl border border-[#e4dfd5] bg-[#fbfaf6] p-6 text-sm text-[#4e5964]">
      Gmail isn't set up on the server yet. Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to enable this module.
    </div>}

    {status?.configured && !status.connected && <div className="rounded-xl border border-[#e4dfd5] bg-[#fbfaf6] p-8 text-center">
      <InboxIcon className="mx-auto mb-3 text-[#9b8045]" size={28} />
      <h2 className="m-0 font-[Manrope] text-lg font-bold text-[#283342]">Connect your Gmail</h2>
      <p className="mx-auto mb-5 mt-2 max-w-md text-sm text-[#7b8288]">Arvo asks for permission to read your mail and create drafts. It can't send or delete anything.</p>
      <a href="/api/inbox/oauth/start" className="button-primary no-underline" data-testid="link-connect-gmail">Connect Gmail</a>
    </div>}

    {brief && <section className="rounded-xl border border-[#e4dfd5] bg-white p-5">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[.1em] text-[#9b8045]">Morning brief</p>
      <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#384452]">{brief}</p>
    </section>}

    {status?.connected && <>
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e4dfd5] bg-[#fbfaf6] px-4 py-3">
        <span className="text-xs text-[#7b8288]">Connected as <strong className="text-[#384452]">{status.email}</strong></span>
        <button type="button" className="ml-auto text-xs text-[#8c9295] underline" onClick={disconnect}>Disconnect</button>
      </section>

      <section className="rounded-xl border border-[#e4dfd5] bg-white p-5">
        <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.1em] text-[#9b8045]"><Star size={12} /> VIP senders (always surfaced as needing a reply)</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {vips.map((email) => <span key={email} className="inline-flex items-center gap-1 rounded-full bg-[#f5ecd9] px-3 py-1 text-xs text-[#8a6a2c]">{email}<button type="button" onClick={() => removeVip(email)} aria-label={`Remove ${email}`}><X size={12} /></button></span>)}
          <form onSubmit={addVip} className="flex gap-2">
            <input value={vipInput} onChange={(e) => setVipInput(e.target.value)} placeholder="investor@fund.com" type="email" required className="rounded-lg border border-[#e4dfd5] bg-white px-3 py-1.5 text-xs" />
            <button type="submit" className="button-secondary">Add</button>
          </form>
        </div>
      </section>

      {!messages.length && <p className="text-sm text-[#7b8288]">No emails triaged yet. Click <strong>Sync inbox</strong> to pull in your last few days of mail.</p>}

      {GROUPS.map((group) => {
        const items = messages.filter((m) => m.category === group.key);
        if (!items.length) return null;
        return <section key={group.key} className="space-y-3">
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-[#283342]"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${group.tone}`}>{group.label}</span> {items.length}</h2>
          {items.map((m) => <article key={m.id} className="rounded-xl border border-[#e4dfd5] bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Mail size={14} className="text-[#9b8045]" />
              <strong className="text-sm text-[#283342]">{m.fromName || m.fromAddress}</strong>
              {m.isVip && <span className="rounded-full bg-[#f5ecd9] px-2 py-0.5 text-[10px] font-bold text-[#8a6a2c]">VIP</span>}
              <span className="ml-auto text-[11px] text-[#8c9295]">{new Date(m.receivedAt).toLocaleString()}</span>
            </div>
            <p className="mb-0 mt-1 text-sm font-semibold text-[#384452]">{m.subject || '(no subject)'}</p>
            <p className="mb-0 mt-1 text-xs text-[#7b8288]">{m.snippet}</p>
            {m.reasoning && <p className="mb-0 mt-2 text-xs italic text-[#8c9295]">{m.reasoning}</p>}
            {m.draftReply && <details className="mt-3 rounded-lg border border-[#e4dfd5] bg-[#fbfaf6] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#9b8045]">{m.gmailDraftId ? 'Draft saved in Gmail — review it there' : 'Draft reply'}</summary>
              <p className="mb-0 mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#4e5964]">{m.draftReply}</p>
            </details>}
          </article>)}
        </section>;
      })}
    </>}
  </div>;
}
