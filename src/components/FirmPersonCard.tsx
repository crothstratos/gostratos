import React from 'react';
import { X, Mail, Building2, Users, Handshake, Loader2, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react';
import { InvestorContact, InvestorRepositoryEntry, Company } from '../types';
import { usePersonCrossReference } from '../hooks/usePersonCrossReference';
import { cn } from '../utils';

/**
 * One person at a firm, and every other place the CRM already knows them.
 *
 * The cross-referencing is the reason this exists. The same human turns up as
 * a contacts-CSV row, as a name typed onto a firm, as a referrer on a deal,
 * and until now those were four unconnected records. Opening a person should
 * show all four.
 */
export function FirmPersonCard({
  contact,
  firm,
  firms,
  onClose,
  onCompanyClick,
}: {
  contact: InvestorContact;
  firm: InvestorRepositoryEntry;
  firms: InvestorRepositoryEntry[];
  onClose: () => void;
  onCompanyClick?: (company: Company) => void;
}) {
  const xref = usePersonCrossReference(
    { name: contact.name, email: contact.email },
    firms,
    firm.id
  );

  const links = xref.contacts.length + xref.otherFirms.length + xref.referredCompanies.length;

  const section = (icon: React.ReactNode, title: string, count: number, children: React.ReactNode, note?: string) => (
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
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="mt-6 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">
                {contact.name || 'Unnamed'}
              </h3>
              {contact.provenance === 'ai-confirmed' && (
                <span
                  title={`Found by research, confirmed by ${contact.confirmedBy || 'a teammate'}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                >
                  <Sparkles size={10} /> AI
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-slate-500 dark:text-slate-400">
              {[contact.role, firm.firmName].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {(contact.email || contact.phone) && (
              <div className="flex flex-col gap-1.5">
                {contact.email && (
                  <div className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <a href={`mailto:${contact.email}`} className="truncate hover:text-indigo-600">{contact.email}</a>
                    {contact.emailSourceUrl && (
                      <a
                        href={contact.emailSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`This address is printed on ${contact.emailSourceUrl}`}
                        className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                      >
                        On site
                      </a>
                    )}
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                    <span className="w-3.5" />
                    <a href={`tel:${contact.phone}`} className="hover:text-indigo-600">{contact.phone}</a>
                  </div>
                )}
              </div>
            )}

            {xref.isLoading && (
              <div className="flex items-center gap-2 py-6 text-[13px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking for this person elsewhere…
              </div>
            )}

            {!xref.isLoading && links === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center dark:border-slate-800">
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  No other record of this person in the CRM.
                </p>
                <p className="mt-1 text-[11.5px] text-slate-400">
                  They only appear here, at {firm.firmName}.
                </p>
              </div>
            )}

            {!xref.isLoading && links > 0 && !xref.matchedOnEmail && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/15">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                <p className="text-[11.5px] text-amber-800 dark:text-amber-400">
                  Matched on name, not email — worth a glance before you treat these as the same person.
                </p>
              </div>
            )}

            {xref.contacts.length > 0 && section(
              <Users className="h-4 w-4 text-indigo-500" />,
              'In your contacts directory',
              xref.contacts.length,
              xref.contacts.map(c => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{c.name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {[c.affiliation, (c.emails || []).join(', '), [c.city, c.state].filter(Boolean).join(', ')]
                      .filter(Boolean).join(' · ') || 'No further details'}
                  </span>
                </div>
              ))
            )}

            {xref.otherFirms.length > 0 && section(
              <Building2 className="h-4 w-4 text-indigo-500" />,
              'Also listed at',
              xref.otherFirms.length,
              xref.otherFirms.map(({ firm: other, role }) => (
                <div key={other.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{other.firmName}</span>
                  {role && <span className="block truncate text-[11.5px] text-slate-400">{role}</span>}
                </div>
              )),
              'The same name appears on another firm in your repository.'
            )}

            {xref.referredCompanies.length > 0 && section(
              <Handshake className="h-4 w-4 text-emerald-500" />,
              'Companies they referred',
              xref.referredCompanies.length,
              xref.referredCompanies.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCompanyClick && onCompanyClick(c)}
                  disabled={!onCompanyClick}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-900',
                    onCompanyClick && 'transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-500/40'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-900 dark:text-white">{c.name}</span>
                    <span className="block truncate text-[11.5px] text-slate-400">
                      {[c.vertical, c.stage].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {onCompanyClick && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
