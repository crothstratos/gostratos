import React from 'react';
import { X, Mail, MapPin, Building2, Share2, Rocket, Loader2 } from 'lucide-react';
import { usePersonProfile } from '../hooks/usePersonProfile';
import { Company } from '../types';
import { cn } from '../utils';

/**
 * One person, and everything the CRM already knows they are connected to.
 * Opens over whatever you were looking at, so following a name never loses
 * your place.
 */
export function PersonProfile({
  contactId,
  onClose,
  onCompanyClick,
}: {
  contactId: string;
  onClose: () => void;
  onCompanyClick?: (company: Company) => void;
}) {
  const { contact, referredCompanies, foundedCompanies, investorFirms, isLoading, error } =
    usePersonProfile(contactId);

  const total = referredCompanies.length + foundedCompanies.length + investorFirms.length;

  const companyRow = (c: Company, why: string) => (
    <button
      key={`${why}-${c.id}`}
      onClick={() => onCompanyClick && onCompanyClick(c)}
      disabled={!onCompanyClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors dark:border-slate-800 dark:bg-slate-900',
        onCompanyClick && 'hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-slate-900 dark:text-white">{c.name}</span>
        <span className="block truncate text-[11.5px] text-slate-400">
          {[c.vertical, c.fund].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>
      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {c.stage}
      </span>
    </button>
  );

  const section = (
    icon: React.ReactNode,
    title: string,
    count: number,
    children: React.ReactNode,
    note?: string
  ) => (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h4 className="text-[12.5px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h4>
        <span className="font-mono text-[11.5px] tabular-nums text-slate-400">{count}</span>
      </div>
      {note && <p className="mb-2 text-[11.5px] text-slate-400">{note}</p>}
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="mt-6 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">
              {contact?.name || (isLoading ? 'Loading…' : 'Unknown person')}
            </h3>
            {contact && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
                {contact.affiliation && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {contact.affiliation}
                  </span>
                )}
                {(contact.city || contact.state) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {[contact.city, contact.state].filter(Boolean).join(', ')}
                  </span>
                )}
                {total > 0 && <span>{total} connection{total === 1 ? '' : 's'}</span>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up connections…
            </div>
          )}

          {error && <p className="py-10 text-center text-[13px] text-slate-500">{error}</p>}

          {contact && !isLoading && (
            <div className="flex flex-col gap-6">
              {contact.emails && contact.emails.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <h4 className="text-[12.5px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">Email</h4>
                    <span className="font-mono text-[11.5px] tabular-nums text-slate-400">{contact.emails.length}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {contact.emails.map(e => (
                      <a key={e} href={`mailto:${e}`} className="truncate text-[13px] text-indigo-600 hover:underline dark:text-indigo-400">
                        {e}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {referredCompanies.length > 0 &&
                section(<Share2 className="h-3.5 w-3.5 text-slate-400" />, 'Companies they referred', referredCompanies.length,
                  referredCompanies.map(c => companyRow(c, 'ref')))}

              {foundedCompanies.length > 0 &&
                section(<Rocket className="h-3.5 w-3.5 text-slate-400" />, 'Companies they founded', foundedCompanies.length,
                  foundedCompanies.map(c => companyRow(c, 'founded')),
                  'Matched on founder email, so this only finds companies where the address was entered exactly.')}

              {investorFirms.length > 0 &&
                section(<Building2 className="h-3.5 w-3.5 text-slate-400" />, 'Investor firms', investorFirms.length,
                  investorFirms.map(f => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                      <span className="block text-[13.5px] font-medium text-slate-900 dark:text-white">{f.firmName}</span>
                      {f.role && <span className="block text-[11.5px] text-slate-400">{f.role}</span>}
                    </div>
                  )))}

              {total === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center dark:border-slate-800">
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">No connections recorded yet</p>
                  <p className="mt-1 text-[11.5px] text-slate-400">
                    They'll appear here once this person is credited as a referrer on a company,
                    listed as a founder, or added to an investor firm.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
