import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardQueryKey, getGetSettingsQueryKey, getListInvoicesQueryKey,
  useGetSettings, useRunSequenceCheck,
} from '@workspace/api-client-react';
import { AlertCircle, Check, CheckCircle2, Clipboard, ExternalLink, Mail, Play, RefreshCw, Server, ShieldCheck, Sparkles, Webhook } from 'lucide-react';

type ReadyFlag = { title: string; detail: string; ready: boolean; icon: typeof Sparkles };

export default function SettingsPage() {
  const settingsQuery = useGetSettings();
  const runCheck = useRunSequenceCheck();
  const [copied, setCopied] = useState(false);
  const [runResult, setRunResult] = useState('');
  const queryClient = useQueryClient();
  const settings = settingsQuery.data;

  const flags: ReadyFlag[] = settings ? [
    {
      title: 'AI message generation',
      detail: settings.groqConfigured
        ? 'AI-written recovery emails can be drafted.'
        : 'GROQ_API_KEY is not set; AI-written emails will be blocked.',
      ready: settings.groqConfigured,
      icon: Sparkles,
    },
    {
      title: 'Stripe webhook',
      detail: settings.stripeWebhookConfigured
        ? 'Signature verification is enabled for invoice.paid events.'
        : 'Add STRIPE_WEBHOOK_SECRET before Stripe can confirm paid invoices.',
      ready: settings.stripeWebhookConfigured,
      icon: Webhook,
    },
    {
      title: 'Email sender',
      detail: settings.resendSenderConfigured
        ? 'A Resend sender address is configured in the environment.'
        : 'Set RESEND_FROM_EMAIL to a verified Resend sender; emails stay blocked until then.',
      ready: settings.resendSenderConfigured,
      icon: Mail,
    },
    { title: 'Scheduled checks', detail: 'Daily sequence checks are enabled.', ready: settings.schedulerEnabled, icon: Server },
  ] : [];
  const readyCount = flags.filter((flag) => flag.ready).length;

  const copyEndpoint = async () => {
    if (!settings?.webhookPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${settings.webhookPath}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const runSequence = () => runCheck.mutate(undefined, {
    onSuccess: async (result) => {
      setRunResult(result.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() }),
      ]);
    },
  });

  return <div className="page-enter">
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#8b7440]"><span className="h-px w-5 bg-[#c5a653]" /> Workspace / configuration</div>
        <h1 className="m-0 font-[Manrope] text-[32px] font-bold tracking-[-.055em] text-[#293544] sm:text-[38px]">Settings</h1>
        <p className="mb-0 mt-2 text-sm text-[#717a82]">Check the connections behind your recovery workflow.</p>
      </div>
      <button type="button" className="button-secondary self-start sm:self-auto" disabled={runCheck.isPending} onClick={runSequence} data-testid="button-settings-run-check">
        <Play size={14} /> {runCheck.isPending ? 'Running check…' : 'Run sequence check'}
      </button>
    </div>
    {runResult && <div className="mb-5 flex items-center justify-between rounded-xl border border-[#d9e2d6] bg-[#f0f5ec] px-4 py-3 text-sm text-[#3c5f4b]" data-testid="status-settings-run"><span className="flex items-center gap-2"><Check size={16} />{runResult}</span><button onClick={() => setRunResult('')} className="text-xs font-semibold">Dismiss</button></div>}
    {runCheck.isError && <div className="mb-5 flex items-center justify-between rounded-xl border border-[#ead3cc] bg-[#fbf1ed] px-4 py-3 text-sm text-[#8a453b]"><span>Sequence check failed. No settings were changed.</span><button onClick={runSequence} className="font-semibold underline">Retry</button></div>}

    {settingsQuery.isLoading ? <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]"><div className="skeleton h-[380px] rounded-2xl" /><div className="skeleton h-[380px] rounded-2xl" /></div> :
      settingsQuery.isError ? <div className="rounded-2xl border border-[#ead3cc] bg-[#fbf1ed] p-7 text-[#8a453b]"><div className="flex items-center gap-2 font-semibold"><AlertCircle size={18} /> Readiness could not be loaded</div><p className="mb-4 mt-2 text-sm">Arvo could not reach the settings service. Try again in a moment.</p><button className="button-secondary" onClick={() => settingsQuery.refetch()}><RefreshCw size={14} /> Retry</button></div> :
      settings && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
        <section className="overflow-hidden rounded-2xl border border-[#e4dfd5] bg-[#fbfaf6]">
          <div className="flex flex-col justify-between gap-4 border-b border-[#e9e4db] px-6 py-5 sm:flex-row sm:items-center">
            <div><h2 className="m-0 font-[Manrope] text-[19px] font-bold tracking-[-.035em]">Integration readiness</h2><p className="mb-0 mt-1 text-xs text-[#81868b]">A live check of the services your sequences depend on.</p></div>
            <div className={`readiness-count ${readyCount === flags.length ? 'readiness-good' : 'readiness-partial'}`}><span className={`h-2 w-2 rounded-full ${readyCount === flags.length ? 'bg-[#648c6f]' : 'bg-[#cb9e4a]'}`} />{readyCount} / {flags.length} ready</div>
          </div>
          <div className="divide-y divide-[#eee9e0]">
            {flags.map((flag) => {
              const Icon = flag.icon;
              return <article key={flag.title} className="flex items-center gap-4 px-6 py-5" data-testid={`readiness-${flag.title.toLowerCase().replaceAll(' ', '-')}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${flag.ready ? 'bg-[#e8efe6] text-[#60816a]' : 'bg-[#f3e9d9] text-[#9e7940]'}`}><Icon size={18} /></span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="m-0 text-[13px] font-semibold text-[#394551]">{flag.title}</h3><span className={`readiness-tag ${flag.ready ? 'ready' : 'not-ready'}`}>{flag.ready ? 'Ready' : 'Needs setup'}</span></div><p className="mb-0 mt-1 text-xs leading-relaxed text-[#7e858a]">{flag.detail}</p></div>
                {flag.ready ? <CheckCircle2 size={18} className="shrink-0 text-[#719078]" /> : <AlertCircle size={18} className="shrink-0 text-[#b18a50]" />}
              </article>;
            })}
          </div>
          <div className="border-t border-[#e9e4db] bg-[#f6f3ec] px-6 py-4 text-[11px] leading-relaxed text-[#737c82]">
            <ShieldCheck size={14} className="mr-1 inline text-[#788b7d]" /> Credentials remain server-side. This readiness panel reports configuration only; it never displays keys.
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-[#e4dfd5] bg-[#fbfaf6] p-6">
            <div className="mb-5 flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e7edf0] text-[#536c80]"><Webhook size={18} /></span><div><h2 className="m-0 font-[Manrope] text-[19px] font-bold tracking-[-.035em]">Stripe webhook</h2><p className="mb-0 mt-1 text-xs text-[#81868b]">Send payment updates to Arvo securely.</p></div></div>
            <div className="mb-5 rounded-xl border border-[#e8e3d9] bg-[#f6f4ee] p-4">
              <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[.1em] text-[#83898d]"><span>Endpoint path</span><span className={`inline-flex items-center gap-1.5 normal-case tracking-normal ${settings.stripeWebhookConfigured ? 'text-[#5d8066]' : 'text-[#9d7945]'}`}><span className={`h-1.5 w-1.5 rounded-full ${settings.stripeWebhookConfigured ? 'bg-[#6b9874]' : 'bg-[#c39a53]'}`} />{settings.stripeWebhookConfigured ? 'Configured' : 'Not configured'}</span></div>
              <div className="flex items-center gap-2"><code className="mono min-w-0 flex-1 break-all text-[12px] text-[#455260]" data-testid="text-webhook-path">{settings.webhookPath}</code><button type="button" onClick={copyEndpoint} className="icon-button shrink-0" title="Copy webhook URL" aria-label="Copy webhook URL" data-testid="button-copy-webhook"><Clipboard size={15} /></button></div>
              {copied && <p className="mb-0 mt-2 text-[10px] font-semibold text-[#60816a]" role="status">Webhook URL copied.</p>}
            </div>
            <ol className="m-0 space-y-3 pl-5 text-[12px] leading-relaxed text-[#69737c]">
              <li>In Stripe, open <strong className="text-[#414e5a]">Developers → Webhooks</strong> and add an endpoint.</li>
              <li>Use your deployed Arvo base URL followed by the path above.</li>
              <li>Subscribe to the <code className="mono">invoice.paid</code> event; Arvo ignores other event types.</li>
              <li>Save the endpoint and add its signing secret in your server environment.</li>
            </ol>
            <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#536c80] no-underline hover:text-[#334d64]" data-testid="link-stripe-webhooks">Open Stripe webhook settings <ExternalLink size={13} /></a>
          </section>
          <section className="rounded-2xl bg-[#263546] p-5 text-[#f5f2ea]">
            <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#d7bb71]">Next step</span><h3 className="mb-0 mt-2 font-[Manrope] text-[17px] font-semibold tracking-[-.025em]">Test the daily sequence</h3></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#34475a] text-[#e6c567]"><RefreshCw size={16} /></span></div>
            <p className="mb-4 mt-2 text-xs leading-relaxed text-[#c0c8ce]">Run a check any time to see which invoices are ready for their next touch.</p>
            <button type="button" onClick={runSequence} disabled={runCheck.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#f0ca63] px-4 py-2.5 text-xs font-bold text-[#273444] transition-colors hover:bg-[#f5d77f] disabled:opacity-60" data-testid="button-run-check">{runCheck.isPending ? 'Checking sequence…' : 'Run sequence check now'} <Play size={13} /></button>
          </section>
        </div>
      </div>}
  </div>;
}