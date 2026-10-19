import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Sparkles, Trash2, TrendingDown, Upload } from 'lucide-react';

type Holding = {
  id: number; symbol: string; assetType: string; account: string; quantity: number;
  costBasisPerUnit: number; acquiredOn: string; currentPrice: number | null;
};
type Opportunity = {
  lotId: number; symbol: string; quantity: number; costBasisPerUnit: number; currentPrice: number;
  loss: number; term: 'short' | 'long'; heldDays: number; estTaxValue: number; washSaleRisk: boolean; note: string | null;
};
type Analysis = {
  daysToYearEnd: number; totalValue: number; totalUnrealizedGain: number; harvestableLossShort: number;
  harvestableLossLong: number; estimatedTaxSavings: number; carryforwardAfter: number;
  opportunities: Opportunity[]; cautions: Opportunity[]; lotsMissingPrice: number;
};
type Settings = { shortTermRate: number; longTermRate: number; realizedShortGains: number; realizedLongGains: number };

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/wealth${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const EMPTY_LOT = { symbol: '', assetType: 'stock', quantity: '', costBasisPerUnit: '', acquiredOn: '', currentPrice: '', account: '' };
const inputClass = 'rounded-lg border border-[#e4dfd5] bg-white px-3 py-1.5 text-xs text-[#384452]';

export default function WealthPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [settings, setSettings] = useState({ st: '32', lt: '15', rst: '0', rlt: '0' });
  const [lot, setLot] = useState(EMPTY_LOT);
  const [csv, setCsv] = useState('');
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, a, s] = await Promise.all([api<Holding[]>('/holdings'), api<Analysis>('/analysis'), api<Settings>('/settings')]);
      setHoldings(h); setAnalysis(a);
      setSettings({ st: String(+(s.shortTermRate * 100).toFixed(2)), lt: String(+(s.longTermRate * 100).toFixed(2)), rst: String(s.realizedShortGains), rlt: String(s.realizedLongGains) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the wealth data.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(null); setNotice(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(null); }
  };

  const addLot = (event: FormEvent) => { event.preventDefault(); void run('add', async () => {
    await api('/holdings', { method: 'POST', body: JSON.stringify(lot) });
    setLot(EMPTY_LOT); await load();
  }); };

  const importCsv = () => run('csv', async () => {
    const r = await api<{ imported: number; errors: string[] }>('/holdings/import', { method: 'POST', body: JSON.stringify({ csv }) });
    setNotice(`Imported ${r.imported} lot${r.imported === 1 ? '' : 's'}.${r.errors.length ? ` ${r.errors.length} row(s) skipped: ${r.errors.slice(0, 3).join(' ')}` : ''}`);
    if (r.imported) setCsv('');
    await load();
  });

  const saveSettings = (event: FormEvent) => { event.preventDefault(); void run('settings', async () => {
    await api('/settings', { method: 'PUT', body: JSON.stringify({
      shortTermRate: Number(settings.st) / 100, longTermRate: Number(settings.lt) / 100,
      realizedShortGains: Number(settings.rst), realizedLongGains: Number(settings.rlt),
    }) });
    setNotice('Tax settings saved.'); await load();
  }); };

  const refreshPrices = () => run('prices', async () => {
    const r = await api<{ updated: number; failed: string[] }>('/prices/refresh', { method: 'POST' });
    setNotice(`Updated ${r.updated} lot(s).${r.failed.length ? ` No price found for: ${r.failed.join(', ')}.` : ''}`);
    await load();
  });

  const makeDigest = () => run('digest', async () => { setDigest((await api<{ digest: string }>('/digest', { method: 'POST' })).digest); });

  const setPrice = async (id: number, value: string, previous: number | null) => {
    const next = value.trim() === '' ? null : Number(value);
    if (next === previous || (next !== null && !Number.isFinite(next))) return;
    await run('price', async () => { await api(`/holdings/${id}`, { method: 'PATCH', body: JSON.stringify({ currentPrice: next }) }); await load(); });
  };
  const remove = (id: number) => run('delete', async () => { await api(`/holdings/${id}`, { method: 'DELETE' }); await load(); });

  const card = (label: string, value: string, tone = 'text-[#283342]') => (
    <div className="rounded-xl border border-[#e4dfd5] bg-white p-4">
      <p className="m-0 text-[10px] font-bold uppercase tracking-[.1em] text-[#9b8045]">{label}</p>
      <p className={`mb-0 mt-1 font-[Manrope] text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );

  const lotRow = (o: Opportunity, caution: boolean) => (
    <article key={o.lotId} className={`rounded-xl border p-4 ${caution ? 'border-[#ecd9a8] bg-[#fdf8ea]' : 'border-[#e4dfd5] bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-[#283342]">{o.symbol}</strong>
        <span className="rounded-full bg-[#eceae4] px-2 py-0.5 text-[10px] font-bold uppercase text-[#6c7378]">{o.term}-term · {o.heldDays} days</span>
        <span className="ml-auto text-sm font-semibold text-[#8a453b]">Unrealized loss {usd(o.loss)}</span>
      </div>
      <p className="mb-0 mt-1 text-xs text-[#7b8288]">{o.quantity} units · cost {usd(o.costBasisPerUnit)} · now {usd(o.currentPrice)}{!caution && ` · worth up to ${usd(o.estTaxValue)} in tax`}</p>
      {o.note && <p className="mb-0 mt-2 text-xs italic text-[#8a6a2c]">{o.note}</p>}
    </article>
  );

  return <div className="space-y-6">
    <header>
      <span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#9b8045]">Wealth &amp; tax</span>
      <h1 className="mb-0 mt-1 font-[Manrope] text-[28px] font-bold tracking-[-.04em] text-[#283342]">Tax-loss harvesting</h1>
      <p className="mb-0 mt-1 text-sm text-[#7b8288]">Arvo scans your holdings for losses you could realize to offset taxable gains, and flags wash-sale risks. It never trades for you.</p>
    </header>

    <p className="m-0 rounded-lg border border-[#ecd9a8] bg-[#fdf8ea] px-4 py-3 text-xs text-[#8a6a2c]" data-testid="text-wealth-disclaimer">
      Informational estimates based on US federal rules and the rates you enter. This is not tax, legal, or investment advice. Confirm with your CPA before acting.
    </p>

    {error && <p className="m-0 rounded-lg bg-[#fbefeb] px-4 py-3 text-sm text-[#8a453b]" role="alert">{error}</p>}
    {notice && <p className="m-0 rounded-lg bg-[#e4eee5] px-4 py-3 text-sm text-[#3c5f4b]">{notice}</p>}

    {analysis && <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {card('Portfolio value', usd(analysis.totalValue))}
      {card('Unrealized gain / loss', usd(analysis.totalUnrealizedGain), analysis.totalUnrealizedGain < 0 ? 'text-[#8a453b]' : 'text-[#3c5f4b]')}
      {card('Harvestable losses', usd(analysis.harvestableLossShort + analysis.harvestableLossLong))}
      {card('Est. tax savings', usd(analysis.estimatedTaxSavings), 'text-[#3c5f4b]')}
      {card('Days to Dec 31', String(analysis.daysToYearEnd))}
    </section>}
    {analysis && analysis.lotsMissingPrice > 0 && <p className="m-0 text-xs text-[#8a6a2c]">{analysis.lotsMissingPrice} lot(s) have no current price and are left out of the numbers above. Type a price in the table or refresh prices.</p>}
    {analysis && analysis.carryforwardAfter > 0 && <p className="m-0 text-xs text-[#7b8288]">Harvesting everything listed would leave about {usd(analysis.carryforwardAfter)} of losses to carry into next year, beyond the $3,000 yearly limit against ordinary income.</p>}

    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-[#283342]"><TrendingDown size={15} /> Harvest opportunities</h2>
        <button type="button" className="button-secondary ml-auto" onClick={makeDigest} disabled={busy !== null}><Sparkles size={14} /> {busy === 'digest' ? 'Writing…' : 'Plain-English alert'}</button>
      </div>
      {digest && <p className="m-0 whitespace-pre-wrap rounded-xl border border-[#e4dfd5] bg-white p-4 text-sm leading-relaxed text-[#384452]">{digest}</p>}
      {analysis && !analysis.opportunities.length && <p className="m-0 text-sm text-[#7b8288]">No harvestable losses found. Add holdings with current prices to see opportunities.</p>}
      {analysis?.opportunities.map((o) => lotRow(o, false))}
      {analysis && analysis.cautions.length > 0 && <>
        <h3 className="m-0 mt-2 text-xs font-bold uppercase tracking-[.08em] text-[#8a6a2c]">Held back: possible wash sale</h3>
        {analysis.cautions.map((o) => lotRow(o, true))}
      </>}
    </section>

    <section className="rounded-xl border border-[#e4dfd5] bg-white p-5">
      <h2 className="m-0 text-sm font-bold text-[#283342]">Your tax assumptions</h2>
      <form onSubmit={saveSettings} className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <label className="field-label">Short-term rate %<input className={inputClass} type="number" step="0.1" value={settings.st} onChange={(e) => setSettings({ ...settings, st: e.target.value })} /></label>
        <label className="field-label">Long-term rate %<input className={inputClass} type="number" step="0.1" value={settings.lt} onChange={(e) => setSettings({ ...settings, lt: e.target.value })} /></label>
        <label className="field-label">Realized short-term gains this year<input className={inputClass} type="number" step="0.01" value={settings.rst} onChange={(e) => setSettings({ ...settings, rst: e.target.value })} /></label>
        <label className="field-label">Realized long-term gains this year<input className={inputClass} type="number" step="0.01" value={settings.rlt} onChange={(e) => setSettings({ ...settings, rlt: e.target.value })} /></label>
        <div className="flex items-end"><button type="submit" className="button-primary" disabled={busy !== null}>Save</button></div>
      </form>
      <p className="mb-0 mt-2 text-[11px] text-[#8c9295]">Gains already realized this year are what harvested losses offset. Use a minus sign for net losses. The short-term rate also stands in for your ordinary income rate.</p>
    </section>

    <section className="rounded-xl border border-[#e4dfd5] bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-sm font-bold text-[#283342]">Holdings ({holdings.length} lots)</h2>
        <button type="button" className="button-secondary ml-auto" onClick={refreshPrices} disabled={busy !== null}><RefreshCw size={14} /> {busy === 'prices' ? 'Refreshing…' : 'Refresh prices'}</button>
      </div>

      <form onSubmit={addLot} className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-8">
        <input className={inputClass} placeholder="Symbol" required value={lot.symbol} onChange={(e) => setLot({ ...lot, symbol: e.target.value })} />
        <select className={inputClass} value={lot.assetType} onChange={(e) => setLot({ ...lot, assetType: e.target.value })}>
          <option value="stock">Stock</option><option value="etf">ETF</option><option value="crypto">Crypto</option><option value="other">Other</option>
        </select>
        <input className={inputClass} placeholder="Quantity" type="number" step="any" required value={lot.quantity} onChange={(e) => setLot({ ...lot, quantity: e.target.value })} />
        <input className={inputClass} placeholder="Cost per unit" type="number" step="any" required value={lot.costBasisPerUnit} onChange={(e) => setLot({ ...lot, costBasisPerUnit: e.target.value })} />
        <input className={inputClass} type="date" required value={lot.acquiredOn} onChange={(e) => setLot({ ...lot, acquiredOn: e.target.value })} />
        <input className={inputClass} placeholder="Price now (optional)" type="number" step="any" value={lot.currentPrice} onChange={(e) => setLot({ ...lot, currentPrice: e.target.value })} />
        <input className={inputClass} placeholder="Account (optional)" value={lot.account} onChange={(e) => setLot({ ...lot, account: e.target.value })} />
        <button type="submit" className="button-primary" disabled={busy !== null}>Add lot</button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs text-[#4e5964]">
          <thead><tr className="text-[10px] uppercase tracking-[.08em] text-[#9b8045]">
            <th className="py-2">Symbol</th><th>Qty</th><th>Cost / unit</th><th>Bought</th><th>Price now</th><th>Gain / loss</th><th />
          </tr></thead>
          <tbody>{holdings.map((h) => {
            const gain = h.currentPrice === null ? null : (h.currentPrice - h.costBasisPerUnit) * h.quantity;
            return <tr key={h.id} className="border-t border-[#efeae0]">
              <td className="py-2 font-semibold text-[#283342]">{h.symbol} <span className="font-normal text-[#8c9295]">{h.assetType}</span></td>
              <td>{h.quantity}</td><td>{usd(h.costBasisPerUnit)}</td><td>{h.acquiredOn}</td>
              <td><input key={`${h.id}-${h.currentPrice}`} className={`${inputClass} w-24`} type="number" step="any" defaultValue={h.currentPrice ?? ''} placeholder="enter" onBlur={(e) => void setPrice(h.id, e.target.value, h.currentPrice)} /></td>
              <td className={gain === null ? '' : gain < 0 ? 'text-[#8a453b]' : 'text-[#3c5f4b]'}>{gain === null ? '—' : usd(gain)}</td>
              <td><button type="button" onClick={() => void remove(h.id)} aria-label={`Delete ${h.symbol} lot`} className="text-[#8c9295] hover:text-[#8a453b]"><Trash2 size={14} /></button></td>
            </tr>;
          })}</tbody>
        </table>
        {!holdings.length && <p className="m-0 py-4 text-sm text-[#7b8288]">No holdings yet. Add a lot above or import a CSV below.</p>}
      </div>

      <details className="mt-4 rounded-lg border border-[#e4dfd5] bg-[#fbfaf6] p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#9b8045]"><Upload size={13} /> Import from CSV</summary>
        <p className="mb-2 mt-2 text-[11px] text-[#7b8288]">One row per purchase lot. Columns: symbol, quantity, cost basis (per share, or total), purchase date, and optionally current price, type, account. Header row optional.</p>
        <textarea className="w-full rounded-lg border border-[#e4dfd5] bg-white px-3 py-2 font-mono text-xs" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'symbol,quantity,cost_basis_per_share,purchase_date,current_price\nAAPL,10,190.50,2025-03-14,172.10'} />
        <div className="mt-2 flex justify-end"><button type="button" className="button-primary" onClick={() => void importCsv()} disabled={busy !== null || !csv.trim()}>{busy === 'csv' ? 'Importing…' : 'Import'}</button></div>
      </details>
    </section>
  </div>;
}
