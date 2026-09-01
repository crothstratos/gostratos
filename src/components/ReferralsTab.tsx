import React, { useMemo, useState } from 'react';
import { Company, Referrer } from '../types';
import { cn } from '../utils';
import { Building2, User, Search, FileSpreadsheet } from 'lucide-react';

/**
 * Who is sending us deals. Aggregates the structured `referrers` field across
 * every company, so a referrer's total holds together even when the same
 * person appears on many deals.
 *
 * Companies referred before this field existed carry only the free-text
 * externalSource; those are counted separately rather than silently ignored,
 * so the numbers are honest about what is not yet linked.
 */

interface Row {
  id: string;
  name: string;
  kind: Referrer['kind'];
  email?: string;
  firmName?: string;
  companies: Company[];
}

export function ReferralsTab({
  companies,
  onCompanyClick,
}: {
  companies: Company[];
  onCompanyClick: (company: Company) => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { rows, linked, unlinkedWithText, noSource } = useMemo(() => {
    const map = new Map<string, Row>();
    let linked = 0;
    let unlinkedWithText = 0;
    let noSource = 0;

    for (const c of companies) {
      const refs = c.referrers || [];
      if (refs.length === 0) {
        if ((c.externalSource || '').trim()) unlinkedWithText++;
        else noSource++;
        continue;
      }
      linked++;
      for (const r of refs) {
        if (!map.has(r.id)) {
          map.set(r.id, { id: r.id, name: r.name, kind: r.kind, email: r.email, firmName: r.firmName, companies: [] });
        }
        map.get(r.id)!.companies.push(c);
      }
    }

    const rows = [...map.values()].sort(
      (a, b) => b.companies.length - a.companies.length || a.name.localeCompare(b.name)
    );
    return { rows, linked, unlinkedWithText, noSource };
  }, [companies]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const exportCsv = () => {
    const lines = [['Referrer', 'Type', 'Email', 'Firm', 'Companies referred', 'Company names'].join(',')];
    for (const r of rows) {
      lines.push([
        r.name,
        r.kind === 'investorFirm' ? 'Firm' : r.kind === 'investorContact' ? 'Firm contact' : 'Contact',
        r.email || '',
        r.firmName || '',
        String(r.companies.length),
        r.companies.map(c => c.name).join('; '),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'referrals.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const stat = (label: string, value: number, tone?: string) => (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</div>
      <div className={cn('mt-0.5 text-[12px]', tone || 'text-slate-500 dark:text-slate-400')}>{label}</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat('Referrers sending deals', rows.length)}
        {stat('Companies with a linked referrer', linked)}
        {stat('Have source text, not yet linked', unlinkedWithText, 'text-amber-600 dark:text-amber-500')}
        {stat('No source recorded', noSource)}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter referrers..."
            className="w-64 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[13px] focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <FileSpreadsheet className="h-4 w-4" /> Export
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center dark:border-slate-800">
            <p className="text-[14px] font-medium text-slate-600 dark:text-slate-300">No referrals recorded yet</p>
            <p className="mt-1 text-[12.5px] text-slate-400">
              Open a company and use the "Referred By" field to credit whoever sent it to you.
              {unlinkedWithText > 0 && ` ${unlinkedWithText} companies have source text that hasn't been linked to a contact.`}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Referrer</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Contact</th>
                  <th className="px-4 py-2.5 text-right font-medium">Companies</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <React.Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {r.kind === 'investorFirm'
                            ? <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            : <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                          <span className="text-[13.5px] font-medium text-slate-900 dark:text-white">{r.name}</span>
                          {r.firmName && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              {r.firmName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-[12.5px] text-slate-400 sm:table-cell">{r.email || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[13px] tabular-nums text-slate-700 dark:text-slate-300">
                        {r.companies.length}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {r.companies.map(c => (
                              <button
                                key={c.id}
                                onClick={e => { e.stopPropagation(); onCompanyClick(c); }}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500/40 dark:hover:text-indigo-300"
                              >
                                {c.name}
                                <span className="ml-1.5 text-[10.5px] text-slate-400">{c.stage}</span>
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
