import React, { useState, useEffect } from 'react';
import { InvestorRepositoryEntry, Company } from '../types';
import { Plus, Search, Edit2, Trash2, Globe, Wand2, X, Building2, User, Mail, Phone, DollarSign, Target, Briefcase, MapPin, Clock } from 'lucide-react';
import { cn, formatLocation } from '../utils';
import { LocationInput } from './LocationInput';
import { InvestorModal } from './InvestorModal';
import { useGemini } from '../hooks/useGemini';
import { useInvestors } from '../hooks/useInvestors';
import { useStaleInvestors } from '../hooks/useInvestorFit';
import { AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';

export const InvestorsTab = React.memo(function InvestorsTab({
  onCompanyClick,
}: {
  /** Opens a portfolio company's profile from inside an investor. */
  onCompanyClick?: (company: Company) => void;
} = {}) {
  const {
    investors,
    isLoading,
    error,
    handleAddInvestor,
    handleUpdateInvestor,
    handleDeleteInvestor
  } = useInvestors();

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showStale, setShowStale] = useState(false);

  // Relationships that have gone quiet. 90 days is a quarter — long enough
  // that a partner would want to know, short enough to still be actionable.
  const stale = useStaleInvestors(investors, 90);
  const [editingInvestor, setEditingInvestor] = useState<InvestorRepositoryEntry | null>(null);

  const {
    isScanning,
    error: scanError,
    setError: setScanError,
    handleScanWebsite: originalHandleScanWebsite
  } = useGemini();

  const [activeModalTab, setActiveModalTab] = useState<'profile' | 'portfolio' | 'people'>('profile');
  const [formData, setFormData] = useState<Partial<InvestorRepositoryEntry>>({
    firmName: '',
    location: undefined,
    website: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    fundDetails: '',
    investmentStage: '',
    checkSize: '',
    verticals: '',
    portfolioCompanies: [],
    notes: '',
  });

  const filteredInvestors = React.useMemo(() => {
    if (!searchQuery.trim()) return investors;
    const query = searchQuery.toLowerCase();
    return investors.filter(i => 
      (i.firmName || '').toLowerCase().includes(query) || 
      formatLocation(i.location).toLowerCase().includes(query) ||
      (i.contactName || '').toLowerCase().includes(query) ||
      (Array.isArray(i.verticals) ? i.verticals.join(',') : i.verticals || '').toLowerCase().includes(query)
    );
  }, [searchQuery, investors]);

  const handleOpenModal = (investor?: InvestorRepositoryEntry) => {
    if (investor) {
      setEditingInvestor(investor);
    setActiveModalTab('profile');
      setFormData(investor);
    } else {
      setEditingInvestor(null);
      setFormData({
        firmName: '',
        location: undefined,
        website: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        fundDetails: '',
        investmentStage: '',
        checkSize: '',
        verticals: '',
        portfolioCompanies: [],
        notes: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firmName) return;

    try {
      if (editingInvestor) {
        await handleUpdateInvestor(editingInvestor.id, formData);
      } else {
        await handleAddInvestor(formData);
      }
      setIsModalOpen(false);
    } catch (err) {
      // Error is handled in the hook
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await handleDeleteInvestor(id);
    } catch (err) {
      // Error is handled in the hook
    }
  };

  const handleScanWebsite = () => {
    if (!formData.website) return;
    
    originalHandleScanWebsite(formData.website, (data) => {
      const companies = data.companies || [];
      const location = data.location || undefined;
      
      setFormData(prev => ({
        ...prev,
        portfolioCompanies: [...(prev.portfolioCompanies || []), ...companies].filter((v, i, a) => a.indexOf(v) === i),
        ...(location && !prev.location ? { location } : {})
      }));
    });
  };

  const removePortfolioCompany = (index: number) => {
    setFormData(prev => ({
      ...prev,
      portfolioCompanies: prev.portfolioCompanies?.filter((_, i) => i !== index) || []
    }));
  };

  const addPortfolioCompany = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      e.preventDefault();
      const val = e.currentTarget.value.trim();
      setFormData(prev => ({
        ...prev,
        portfolioCompanies: [...(prev.portfolioCompanies || []), val]
      }));
      e.currentTarget.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Investors Repository</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Centralized database for investor contacts and fund details.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search investors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:text-white"
            />
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Plus size={16} />
            Add Investor
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {stale.length > 0 && !searchQuery && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-800/40 dark:bg-amber-900/15">
            <button
              type="button"
              onClick={() => setShowStale(v => !v)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span className="flex-1 text-[13.5px] font-medium text-amber-900 dark:text-amber-300">
                {stale.length} {stale.length === 1 ? 'relationship has' : 'relationships have'} gone quiet
              </span>
              <ChevronRight
                className={cn(
                  'h-4 w-4 shrink-0 text-amber-600 transition-transform dark:text-amber-500',
                  showStale && 'rotate-90'
                )}
              />
            </button>

            {showStale && (
              <div className="border-t border-amber-200/70 px-4 py-3 dark:border-amber-800/40">
                <p className="mb-2.5 text-[11.5px] text-amber-800/80 dark:text-amber-400/80">
                  No note logged in 90 days. Where a firm has no notes at all, this falls back to when
                  the record was last edited — a weaker signal, marked below.
                </p>
                <div className="flex flex-col gap-1.5">
                  {stale.slice(0, 12).map(({ firm, daysSince, basis }) => (
                    <button
                      key={firm.id}
                      type="button"
                      onClick={() => handleOpenModal(firm)}
                      className="flex items-center gap-3 rounded-lg border border-amber-200/70 bg-white px-3 py-2 text-left transition-colors hover:border-amber-300 dark:border-amber-800/40 dark:bg-slate-900"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900 dark:text-white">
                        {firm.firmName}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-slate-400">
                        {daysSince === null
                          ? 'never logged'
                          : `${daysSince} days${basis === 'edit' ? ' (last edit)' : ''}`}
                      </span>
                    </button>
                  ))}
                  {stale.length > 12 && (
                    <p className="pt-1 text-[11.5px] text-amber-800/70 dark:text-amber-400/70">
                      +{stale.length - 12} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {error ? (
          <div className="rounded-lg bg-red-50 p-4 text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : filteredInvestors.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50">
            <Briefcase className="mb-4 h-12 w-12 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-white">No investors found</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {searchQuery ? "Try adjusting your search query." : "Get started by adding your first investor."}
            </p>
            {!searchQuery && (
              <button
                onClick={() => handleOpenModal()}
                className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                <Plus size={16} />
                Add Investor
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredInvestors.map(investor => (
              <div 
                key={investor.id}
                onClick={() => handleOpenModal(investor)}
                className="group relative cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm transition-all hover:shadow-md"
              >
                <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100 flex gap-2">
                  <button
                    onClick={(e) => handleDelete(investor.id, e)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="mb-4 flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400">
                    <Building2 size={24} />
                  </div>
                  <div>
                    <h3 className="flex items-center gap-1.5 text-lg font-semibold text-slate-900 dark:text-white">
                      {investor.firmName}
                      {investor.coInvestorsResearchedAt && (
                        // The tooltip sits on a span: lucide icons render an
                        // <svg> and do not forward a title attribute.
                        <span
                          title={
                            `Co-investors researched ${new Date(investor.coInvestorsResearchedAt).toLocaleDateString()}` +
                            (typeof investor.coInvestorsFound === 'number'
                              ? ` — ${investor.coInvestorsFound} found`
                              : '')
                          }
                          aria-label="Co-investor research done"
                          className="flex shrink-0 items-center"
                        >
                          <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-500" />
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-col gap-1 mt-1">
                      {investor.location && (
                        <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                          <MapPin size={14} />
                          {formatLocation(investor.location)}
                        </div>
                      )}
                      {investor.website && (
                        <a 
                          href={investor.website.startsWith('http') ? investor.website : `https://${investor.website}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                        >
                          <Globe size={14} />
                          Website
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <User size={16} className="text-slate-400" />
                    <span>{investor.contactName || 'No contact specified'}</span>
                  </div>
                  {(investor.contactEmail || investor.contactPhone) && (
                    <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                      {investor.contactEmail && (
                        <a href={`mailto:${investor.contactEmail}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 hover:text-indigo-600">
                          <Mail size={16} className="text-slate-400" />
                          <span className="truncate max-w-[120px]">{investor.contactEmail}</span>
                        </a>
                      )}
                      {investor.contactPhone && (
                        <a href={`tel:${investor.contactPhone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 hover:text-indigo-600 ml-2">
                          <Phone size={16} className="text-slate-400" />
                          <span>{investor.contactPhone}</span>
                        </a>
                      )}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Stage</p>
                      <p className="text-sm text-slate-900 dark:text-white truncate">{investor.investmentStage || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Check Size</p>
                      <p className="text-sm text-slate-900 dark:text-white truncate">{investor.checkSize || '-'}</p>
                    </div>
                  </div>
                  
                  {investor.verticals && (
                    <div className="pt-2">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Verticals</p>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray(investor.verticals) ? investor.verticals : investor.verticals?.split(',')).slice(0, 3).map((v, i) => (
                          <span key={i} className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {typeof v === 'string' ? v.trim() : v}
                          </span>
                        ))}
                        {((Array.isArray(investor.verticals) ? investor.verticals.length : investor.verticals?.split(',')?.length) || 0) > 3 && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                            +{((Array.isArray(investor.verticals) ? investor.verticals.length : investor.verticals?.split(',')?.length) || 0) - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <InvestorModal
          investor={editingInvestor ? (editingInvestor as any) : (formData as any)}
          isNew={!editingInvestor}
          onCompanyClick={onCompanyClick}
          allFirms={investors}
          onAddFirm={(entry) => handleAddInvestor(entry as any)}
          onPersist={(patch) => {
            if (editingInvestor) handleUpdateInvestor(editingInvestor.id, patch as any);
          }}
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => {
             // Adapt the handleSave to match what it expects
             if (editingInvestor) {
               handleUpdateInvestor(editingInvestor.id, data);
             } else {
               handleAddInvestor(data as any);
             }
             setIsModalOpen(false);
          }}
        />
      )}
    </div>
  );
});