import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey, getListInvoicesQueryKey, useCreateInvoice,
  useGetDashboard, useListInvoices, useMarkInvoicePaid, useNegotiateInvoice,
  useRunSequenceCheck, useUpdateInvoiceStatus,
} from '@workspace/api-client-react';
import type { Invoice, InvoiceInput, InvoiceStatus, NegotiationResult } from '@workspace/api-client-react';
import { ArrowDown, ArrowUpRight, Check, ChevronDown, Clock3, FilePlus2, Handshake, Mail, Pause, Play, RefreshCw, Search, Sparkles, WalletCards, X } from 'lucide-react';

type StatusFilter = 'all' | InvoiceStatus;

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};
const dateShort = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const since = (value: string) => {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

function Metric({ label, value, detail, tone = 'ink', icon }: { label: string; value: string; detail: string; tone?: string; icon: ReactNode }) {
  return <article className={`metric metric-${tone}`}>
    <div className="mb-5 flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-[.1em] text-[#707a85]">{label}</span><span className="metric-icon">{icon}</span></div>
    <div className="font-[Manrope] text-[29px] font-bold leading-none tracking-[-.055em] text-[#293544]">{value}</div>
    <div className="mt-2 text-xs text-[#7b838a]">{detail}</div>
  </article>;
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [negotiatingInvoice, setNegotiatingInvoice] = useState<Invoice | null>(null);
  const [runReport, setRunReport] = useState<{ checked: number; completed: number; blocked: number; message: string } | null>(null);
  const [formError, setFormError] = useState('');
  const queryClient = useQueryClient();
  const params = useMemo(() => ({
    ...(filter !== 'all' ? { status: filter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }), [filter, search]);
  const invoicesQuery = useListInvoices(params);
  const dashboardQuery = useGetDashboard();
  const createInvoice = useCreateInvoice();
  const updateStatus = useUpdateInvoiceStatus();
  const markPaid = useMarkInvoicePaid();
  const runCheck = useRunSequenceCheck();
  const invoices = invoicesQuery.data ?? [];
  const dashboard = dashboardQuery.data;
  const currencyTotals = dashboard?.outstandingByCurrency ?? [];
  const outstandingValue = currencyTotals.length === 0
    ? money(0, 'USD')
    : currencyTotals.length === 1
      ? money(currencyTotals[0].amountCents, currencyTotals[0].currency)
      : `${currencyTotals.length} currencies`;
  const outstandingDetail = currencyTotals.length > 1
    ? currencyTotals.map((total) => `${money(total.amountCents, total.currency)} ${total.currency.toUpperCase()}`).join(' · ')
    : 'Across tracked accounts';

  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
    ]);
  };

  const submitInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    const form = new FormData(event.currentTarget);
    const input: InvoiceInput = {
      customerName: String(form.get('customerName') || '').trim(),
      customerEmail: String(form.get('customerEmail') || '').trim(),
      invoiceNumber: String(form.get('invoiceNumber') || '').trim(),
      amountCents: Math.round(Number(form.get('amount')) * 100),
      currency: String(form.get('currency') || 'USD').toUpperCase(),
      dueDate: String(form.get('dueDate') || ''),
      tone: String(form.get('tone') || 'friendly') as InvoiceInput['tone'],
      stripeInvoiceId: String(form.get('stripeInvoiceId') || '').trim() || null,
    };
    if (!input.customerName || !input.customerEmail || !input.invoiceNumber || !(input.amountCents > 0) || !input.dueDate) {
      setFormError('Fill in each required field with a valid amount and due date.');
      return;
    }
    createInvoice.mutate({ data: input }, {
      onSuccess: async () => { setShowCreate(false); await refreshWorkspace(); },
      onError: () => setFormError('We could not track this invoice. Check the details and try again.'),
    });
  };

  const runSequence = () => runCheck.mutate(undefined, {
    onSuccess: async (result) => { setRunReport(result); await refreshWorkspace(); },
  });

  const statusCounts: [StatusFilter, string][] = [
    ['all', `All invoices${dashboard ? ` · ${dashboard.trackedCount}` : ''}`],
    ['active', `Active${dashboard ? ` · ${dashboard.activeCount}` : ''}`],
    ['paused', `Paused${dashboard ? ` · ${dashboard.pausedCount}` : ''}`],
    ['paid', `Paid${dashboard ? ` · ${dashboard.paidCount}` : ''}`],
  ];

  return <div className="page-enter">
    <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#8b7440]"><span className="h-px w-5 bg-[#c5a653]" /> Accounts receivable / overview</div>
        <h1 className="m-0 font-[Manrope] text-[32px] font-bold tracking-[-.055em] text-[#293544] sm:text-[38px]">Recovery desk</h1>
        <p className="mb-0 mt-2 text-sm text-[#717a82]">A clear view of what is owed, and what needs attention.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runSequence} disabled={runCheck.isPending} className="button-secondary" data-testid="button-run-sequence">
          <RefreshCw size={15} className={runCheck.isPending ? 'animate-spin' : ''} /> {runCheck.isPending ? 'Checking accounts…' : 'Run sequence check'}
        </button>
        <button type="button" onClick={() => { setFormError(''); setShowCreate(true); }} className="button-primary" data-testid="button-track-invoice"><FilePlus2 size={16} /> Track invoice</button>
      </div>
    </div>

    {runReport && <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#d9e2d6] bg-[#f0f5ec] px-4 py-3 text-sm text-[#3c5f4b]" data-testid="status-sequence-run">
      <span className="flex items-center gap-2 font-semibold"><Check size={16} /> {runReport.message}</span>
      <span>{runReport.checked} checked</span><span>{runReport.completed} actions completed</span><span>{runReport.blocked} blocked</span>
      <button type="button" className="ml-auto text-[#5a7564]" onClick={() => setRunReport(null)} aria-label="Dismiss report"><X size={16} /></button>
    </div>}
    {runCheck.isError && <div className="mb-5 flex items-center justify-between rounded-xl border border-[#ead3cc] bg-[#fbf1ed] px-4 py-3 text-sm text-[#8a453b]" role="alert">
      <span>Sequence check could not run just now.</span><button className="text-sm font-semibold underline" onClick={runSequence}>Retry</button>
    </div>}

    {dashboardQuery.isLoading ? <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-[142px] rounded-2xl" />)}</div> : dashboardQuery.isError ? <div className="mb-8 rounded-2xl border border-[#ead3cc] bg-[#fbf1ed] p-5 text-sm text-[#8a453b]">Dashboard totals did not load. <button className="ml-2 font-semibold underline" onClick={() => dashboardQuery.refetch()}>Try again</button></div> : <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Outstanding" value={outstandingValue} detail={outstandingDetail} tone="gold" icon={<WalletCards size={17} />} />
      <Metric label="Active sequences" value={String(dashboard?.activeCount ?? 0)} detail="Following up automatically" tone="blue" icon={<Sparkles size={17} />} />
      <Metric label="Recovered" value={String(dashboard?.paidCount ?? 0)} detail="Invoices marked paid" tone="green" icon={<Check size={17} />} />
      <Metric label="On hold" value={String(dashboard?.pausedCount ?? 0)} detail="Paused by your team" tone="warm" icon={<Pause size={16} />} />
    </section>}

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
      <section className="min-w-0 rounded-2xl border border-[#e4dfd5] bg-[#fbfaf6] shadow-[0_4px_20px_rgba(40,48,56,.025)]">
        <div className="flex flex-col gap-4 border-b border-[#ebe6dd] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="m-0 font-[Manrope] text-[19px] font-bold tracking-[-.035em]">Invoices to recover</h2><p className="mb-0 mt-1 text-xs text-[#81868b]">Review and manage each customer conversation.</p></div>
            <span className="rounded-full bg-[#eeeae1] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#6c7378]">Live list</span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {statusCounts.map(([status, label]) => <button key={status} type="button" onClick={() => setFilter(status)} className={`filter-pill ${filter === status ? 'filter-pill-selected' : ''}`} data-testid={`filter-invoices-${status}`}>{label}</button>)}
            </div>
            <label className="search-wrap"><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or invoice" aria-label="Search invoices" data-testid="input-search-invoices" /><kbd>/</kbd></label>
          </div>
        </div>
        {invoicesQuery.isLoading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-[68px] rounded-lg" />)}</div> :
          invoicesQuery.isError ? <div className="p-8 text-center"><p className="text-sm text-[#8a453b]">Invoices are unavailable at the moment.</p><button className="button-secondary mt-2" onClick={() => invoicesQuery.refetch()}>Retry loading</button></div> :
          invoices.length === 0 ? <div className="px-6 py-14 text-center" data-testid="empty-invoices">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#eee9dd] text-[#79808a]"><FilePlus2 size={20} /></div>
            <h3 className="m-0 font-[Manrope] text-base font-bold">{search || filter !== 'all' ? 'No matching invoices' : 'Your recovery desk is clear'}</h3>
            <p className="mx-auto mb-4 mt-2 max-w-sm text-sm text-[#7b8289]">{search || filter !== 'all' ? 'Try a different search or status filter.' : 'Track an overdue invoice to start a thoughtful follow-up sequence.'}</p>
            {!search && filter === 'all' && <button className="button-primary" onClick={() => setShowCreate(true)}><FilePlus2 size={15} /> Track first invoice</button>}
          </div> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead><tr className="border-b border-[#eee9e0] text-[10px] font-bold uppercase tracking-[.1em] text-[#899097]">
                <th className="px-6 py-3.5">Customer</th><th className="px-4 py-3.5">Invoice</th><th className="px-4 py-3.5">Due date</th><th className="px-4 py-3.5">Sequence</th><th className="px-4 py-3.5 text-right">Amount</th><th className="px-6 py-3.5 text-right">Actions</th>
              </tr></thead>
              <tbody>{invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} busy={updateStatus.isPending || markPaid.isPending} onPause={() => updateStatus.mutate({ id: invoice.id, data: { status: invoice.status === 'paused' ? 'active' : 'paused' } }, { onSuccess: refreshWorkspace })} onPaid={() => markPaid.mutate({ id: invoice.id }, { onSuccess: refreshWorkspace })} onNegotiate={() => setNegotiatingInvoice(invoice)} />)}</tbody>
            </table>
          </div>}
        <div className="flex items-center justify-between border-t border-[#eee9e0] px-6 py-3 text-[11px] text-[#858b90]"><span>Showing {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</span><span>All amounts in invoice currency</span></div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-2xl border border-[#e4dfd5] bg-[#fbfaf6] p-5">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="m-0 font-[Manrope] text-[17px] font-bold tracking-[-.03em]">Recent activity</h2><p className="mb-0 mt-1 text-xs text-[#81868b]">Latest sequence touches</p></div><Clock3 size={17} className="text-[#9b8b68]" /></div>
          {dashboardQuery.isLoading ? <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className="skeleton h-12 rounded-lg" />)}</div> :
            dashboardQuery.isError ? <p className="text-sm text-[#8a453b]">Activity could not be loaded. <button onClick={() => dashboardQuery.refetch()} className="underline">Retry</button></p> :
            !dashboard?.recentActivity.length ? <div className="rounded-xl bg-[#f3f0e8] px-4 py-5 text-center"><p className="mb-1 text-sm font-semibold text-[#4d5965]">No touches yet</p><p className="m-0 text-xs leading-relaxed text-[#81868b]">Sequence activity will appear here as recovery begins.</p></div> :
            <ol className="m-0 list-none space-y-0 p-0">{dashboard.recentActivity.slice(0, 6).map((activity, index) => <li key={activity.id} className="relative flex gap-3 pb-5 last:pb-0" data-testid={`activity-item-${activity.id}`}>
              {index < Math.min(dashboard.recentActivity.length, 6) - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-[#e8e2d7]" />}
              <span className={`relative z-10 mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${activity.result === 'sent' || activity.result === 'logged' ? 'bg-[#e4eee5] text-[#58775f]' : 'bg-[#f5e9de] text-[#986d47]'}`}>{activity.actionType === 'email' ? <Mail size={9} /> : <ArrowUpRight size={9} />}</span>
              <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="m-0 text-[12px] font-semibold leading-snug text-[#3c4854]">{activity.customerName}</p><span className="shrink-0 text-[10px] text-[#92979b]">{since(activity.createdAt)}</span></div><p className="mb-0 mt-1 text-[11px] leading-relaxed text-[#7d858b]">{activity.summary}</p><span className="mono mt-1 inline-block text-[9px] text-[#9b8c6d]">{activity.invoiceNumber} · day {activity.actionDay}</span></div>
            </li>)}</ol>}
        </section>
        <section className="relative overflow-hidden rounded-2xl bg-[#e9e4d8] p-5">
          <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border border-[#d5cbb4]" /><div className="absolute -right-3 -top-5 h-16 w-16 rounded-full border border-[#d5cbb4]" />
          <span className="mono text-[9px] font-medium uppercase tracking-[.16em] text-[#927b46]">Recovery, by the numbers</span>
          <p className="mb-0 mt-3 max-w-[210px] font-[Manrope] text-[20px] font-semibold leading-tight tracking-[-.04em] text-[#394351]">Consistency is a better collector than urgency.</p>
          <div className="mt-5 flex items-center gap-2 text-[11px] font-semibold text-[#65706e]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#d8e0d5]"><ArrowDown size={12} /></span> Keep every follow-up measured.</div>
        </section>
      </aside>
    </div>

    {showCreate && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="new-invoice-title" className="modal-card">
        <div className="mb-5 flex items-start justify-between"><div><span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#9b8045]">New recovery account</span><h2 id="new-invoice-title" className="mb-0 mt-1 font-[Manrope] text-[23px] font-bold tracking-[-.04em]">Track an invoice</h2><p className="mb-0 mt-1 text-sm text-[#7b8288]">Arvo will begin with the tone you choose.</p></div><button className="icon-button" type="button" onClick={() => setShowCreate(false)} aria-label="Close form"><X size={18} /></button></div>
        <form onSubmit={submitInvoice} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Customer name<input name="customerName" required placeholder="Morgan Lee" data-testid="input-customer-name" /></label><label className="field-label">Customer email<input name="customerEmail" required type="email" placeholder="morgan@company.com" data-testid="input-customer-email" /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Invoice number<input name="invoiceNumber" required placeholder="INV-1048" data-testid="input-invoice-number" /></label><label className="field-label">Amount<input name="amount" required type="number" min="0.01" step="0.01" placeholder="1,250.00" data-testid="input-invoice-amount" /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Due date<input name="dueDate" required type="date" data-testid="input-due-date" /></label><label className="field-label">Currency<select name="currency" defaultValue="USD" data-testid="select-currency"><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound sterling</option><option value="CAD">CAD — Canadian dollar</option><option value="AUD">AUD — Australian dollar</option></select></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="field-label">Follow-up tone<select name="tone" defaultValue="friendly" data-testid="select-tone"><option value="friendly">Friendly</option><option value="warm">Warm</option><option value="direct">Direct</option><option value="formal">Formal</option></select></label><label className="field-label">Stripe invoice ID <span className="font-normal text-[#8c9295]">optional</span><input name="stripeInvoiceId" placeholder="in_…" data-testid="input-stripe-invoice-id" /></label></div>
          {formError && <p className="m-0 rounded-lg bg-[#fbefeb] px-3 py-2 text-xs text-[#8a453b]" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="button-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" disabled={createInvoice.isPending} className="button-primary">{createInvoice.isPending ? 'Adding invoice…' : 'Start recovery'}</button></div>
        </form>
      </section>
    </div>}

    {negotiatingInvoice && <NegotiationModal invoice={negotiatingInvoice} onClose={() => setNegotiatingInvoice(null)} onSent={refreshWorkspace} />}
  </div>;
}

function NegotiationModal({ invoice, onClose, onSent }: { invoice: Invoice; onClose: () => void; onSent: () => void }) {
  const [clientMessage, setClientMessage] = useState('');
  const [result, setResult] = useState<NegotiationResult | null>(null);
  const negotiate = useNegotiateInvoice();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!clientMessage.trim()) return;
    negotiate.mutate(
      { id: invoice.id, data: { clientMessage: clientMessage.trim() } },
      { onSuccess: (data) => { setResult(data); onSent(); } },
    );
  };

  const decisionLabel = result?.decision === 'accept' ? 'Accepted' : result?.decision === 'counter' ? 'Countered' : 'Held firm';
  const decisionTone = result?.decision === 'accept' ? 'bg-[#e4eee5] text-[#3c5f4b]' : result?.decision === 'counter' ? 'bg-[#f5ecd9] text-[#8a6a2c]' : 'bg-[#fbefeb] text-[#8a453b]';

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="negotiate-title" className="modal-card">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#9b8045]">AI negotiation</span>
          <h2 id="negotiate-title" className="mb-0 mt-1 font-[Manrope] text-[21px] font-bold tracking-[-.04em]">{invoice.customerName} — {invoice.invoiceNumber}</h2>
          <p className="mb-0 mt-1 text-sm text-[#7b8288]">Paste what the client said in reply. Arvo will decide within policy and send the response.</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      {!result ? <form onSubmit={submit} className="space-y-3">
        <label className="field-label">Client's message
          <textarea
            value={clientMessage}
            onChange={(event) => setClientMessage(event.target.value)}
            required
            rows={5}
            placeholder="e.g. 'We can pay but need to split this into a few payments over the next couple months.'"
            data-testid="input-negotiation-message"
            className="w-full rounded-lg border border-[#e4dfd5] bg-white px-3 py-2 text-sm text-[#384452]"
          />
        </label>
        {negotiate.isError && <p className="m-0 rounded-lg bg-[#fbefeb] px-3 py-2 text-xs text-[#8a453b]" role="alert">Arvo could not reach the negotiation engine. Try again.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={negotiate.isPending} className="button-primary">{negotiate.isPending ? 'Deciding…' : 'Send to Arvo'}</button>
        </div>
      </form> : <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${decisionTone}`}>{decisionLabel}</span>
          {!result.emailSent && <span className="text-[11px] text-[#8a453b]">Reply drafted but not sent — email delivery failed.</span>}
        </div>
        {result.terms && <p className="m-0 text-xs text-[#6c7378]">Terms: {Object.entries(result.terms).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
        <p className="m-0 text-xs italic text-[#8c9295]">{result.reasoning}</p>
        <div className="rounded-lg border border-[#e4dfd5] bg-[#fbfaf6] p-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9b8045]">{result.replySubject}</p>
          <p className="mb-0 mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[#4e5964]">{result.replyBody}</p>
        </div>
        <div className="flex justify-end pt-2"><button type="button" className="button-primary" onClick={onClose}>Done</button></div>
      </div>}
    </section>
  </div>;
}

function InvoiceRow({ invoice, busy, onPause, onPaid, onNegotiate }: { invoice: Invoice; busy: boolean; onPause: () => void; onPaid: () => void; onNegotiate: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const overdue = Math.max(0, Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86_400_000));
  return <tr className="invoice-row" data-testid={`row-invoice-${invoice.id}`}>
    <td className="px-6 py-4"><div className="flex items-center gap-3"><span className="customer-initial">{invoice.customerName.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><div className="min-w-0"><p className="m-0 truncate text-[13px] font-semibold text-[#384452]">{invoice.customerName}</p><p className="mb-0 mt-0.5 truncate text-[11px] text-[#858b90]">{invoice.customerEmail}</p></div></div></td>
    <td className="px-4 py-4"><span className="mono text-[11px] font-medium text-[#58636e]">{invoice.invoiceNumber}</span><span className={`status-chip status-${invoice.status}`}>{invoice.status}</span></td>
    <td className="px-4 py-4"><div className="text-[12px] text-[#505b65]">{dateShort(invoice.dueDate)}</div><div className={`mt-1 text-[10px] ${invoice.status === 'paid' ? 'text-[#66846c]' : overdue > 0 ? 'text-[#b06b4e]' : 'text-[#92979b]'}`}>{invoice.status === 'paid' ? 'Settled' : overdue > 0 ? `${overdue} days overdue` : 'Due soon'}</div></td>
    <td className="px-4 py-4"><div className="text-[12px] font-medium text-[#58636e]">Day {invoice.sequenceDay}<span className="text-[#a1a4a4]"> / 14</span></div><div className="mt-1 h-1 w-[72px] overflow-hidden rounded-full bg-[#e9e5dc]"><span className="block h-full rounded-full bg-[#a8b5a5]" style={{ width: `${Math.min(100, invoice.sequenceDay / 14 * 100)}%` }} /></div></td>
    <td className="px-4 py-4 text-right mono text-[12px] font-medium text-[#35404b]">{money(invoice.amountCents, invoice.currency)}</td>
    <td className="relative px-6 py-4 text-right"><div className="flex justify-end gap-1.5">
      {invoice.status !== 'paid' && <button type="button" disabled={busy} className="row-action" onClick={onPause} title={invoice.status === 'paused' ? 'Resume sequence' : 'Pause sequence'} data-testid={`${invoice.status === 'paused' ? 'button-resume' : 'button-pause'}-${invoice.id}`}>{invoice.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}</button>}
       {invoice.status !== 'paid' && <button type="button" disabled={busy} className="row-action row-action-paid" onClick={onPaid} title="Mark invoice paid" data-testid={`button-mark-paid-${invoice.id}`}><Check size={14} /></button>}
      {invoice.status !== 'paid' && <button type="button" className="row-action" onClick={onNegotiate} title="Negotiate payment terms" data-testid={`button-negotiate-${invoice.id}`}><Handshake size={14} /></button>}
      <button type="button" className="row-action" onClick={() => setMenuOpen(!menuOpen)} aria-label="More invoice details" aria-expanded={menuOpen} data-testid={`button-invoice-menu-${invoice.id}`}><ChevronDown size={14} /></button>
    </div>{menuOpen && <div className="row-menu"><p className="mono mb-2 text-[9px] uppercase tracking-[.12em] text-[#969b9f]">Latest touch</p><p className="m-0 text-[11px] font-medium text-[#4e5964]">{invoice.lastActionTaken || 'No action recorded'}</p><p className="mb-0 mt-1 text-[10px] text-[#858b90]">{invoice.lastActionAt ? dateShort(invoice.lastActionAt) : `Tone: ${invoice.tone}`}</p><button className="mt-3 w-full border-t border-[#eee9e0] pt-2 text-left text-[10px] font-semibold text-[#536a7e]" onClick={() => setMenuOpen(false)}>Close details</button></div>}</td>
  </tr>;
}