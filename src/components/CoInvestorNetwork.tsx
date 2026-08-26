import React, { useState } from 'react';
import { Company, InvestorRepositoryEntry } from '../types';
import { Network, Search, ExternalLink, Building2, User, Sparkles, Target } from 'lucide-react';
import { useGemini } from '../hooks/useGemini';
import { useCompanies } from '../hooks/useCompanies';
import { useAuth } from './AuthContext';

interface CoInvestorNetworkProps {
  company: Company;
  investors: InvestorRepositoryEntry[];
  onSave?: (company: Company) => void;
}

export function CoInvestorNetwork({ company, investors, onSave }: CoInvestorNetworkProps) {
  const { user } = useAuth();
  const { companies } = useCompanies(user);
  const { isGenerating, handleDiscoverCoinvestors } = useGemini();
  const [aiSuggestions, setAiSuggestions] = useState<any[]>(company.aiCoInvestors || []);

  const matchingInvestors = React.useMemo(() => {
    if (!company.name) return [];
    const companyName = company.name.toLowerCase();
    return investors.filter(inv => {
      const ports = inv.portfolioCompanies || [];
      return ports.some(p => {
        if (!p) return false;
        const pLower = p.toLowerCase();
        return pLower === companyName || pLower.includes(companyName) || companyName.includes(pLower);
      });
    });
  }, [investors, company.name]);

  const lookalikeCompanies = React.useMemo(() => {
    if (!company.vertical) return [];
    return companies.filter(c => 
      c.id !== company.id && 
      c.vertical === company.vertical && 
      c.stage === company.stage
    ).slice(0, 5);
  }, [companies, company]);

  const handleDiscover = () => {
    handleDiscoverCoinvestors(
      company.name || '',
      company.basics || company.companySolution || '',
      company.vertical || '',
      (data) => {
        const investors = data.investors || [];
        setAiSuggestions(investors);
        if (onSave) {
          onSave({ ...company, aiCoInvestors: investors });
        }
      }
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Existing Investors from CRM */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Network size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Cap Table & Co-Investors</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Investors in our CRM whose portfolio includes {company.name || 'this company'}.
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {matchingInvestors.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
              <Building2 size={32} className="mx-auto text-slate-400 dark:text-slate-500 mb-3" />
              <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">No matching investors found</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                None of the investors in your CRM list this company in their portfolio.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {matchingInvestors.map(inv => (
                <div key={inv.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors">
                  <div className="flex justify-between items-start">
                    <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{inv.firmName}</h4>
                    {inv.website && (
                      <a href={inv.website} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-indigo-500">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                  {inv.contactName && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-slate-600 dark:text-slate-400">
                      <User size={14} />
                      <span>{inv.contactName}</span>
                    </div>
                  )}
                  <div className="mt-3 text-xs flex flex-wrap gap-2">
                    {inv.investmentStage && (
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-600 dark:text-slate-400">
                        {Array.isArray(inv.investmentStage) ? inv.investmentStage.join(', ') : inv.investmentStage}
                      </span>
                    )}
                    {inv.checkSize && (
                      <span className="px-2 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-md">
                        {inv.checkSize}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Discovery */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-600 dark:text-fuchsia-400 rounded-lg">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">AI Co-Investor Discovery</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Find funds that invest in similar companies.
              </p>
            </div>
          </div>
          <button 
            onClick={handleDiscover}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search size={16} />
                Discover
              </>
            )}
          </button>
        </div>

        {aiSuggestions.length > 0 && (
          <div className="p-6">
            <div className="grid grid-cols-1 gap-4">
              {aiSuggestions.map((sug, idx) => {
                // Check if this AI suggested investor exists in our CRM
                const inCRM = investors.find(i => i.firmName.toLowerCase().includes(sug.name.toLowerCase()) || sug.name.toLowerCase().includes(i.firmName.toLowerCase()));
                
                return (
                  <div key={idx} className="border border-slate-200 dark:border-slate-700 rounded-lg p-5 hover:border-fuchsia-300 dark:hover:border-fuchsia-600 transition-colors bg-white dark:bg-slate-800">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{sug.name}</h4>
                        {inCRM && (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400 rounded">
                            In CRM
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 mb-4 leading-relaxed">{sug.rationale}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">Similar Investments:</span>
                      {sug.similarInvestments?.map((sim: string, i: number) => (
                        <span key={i} className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300">
                          {sim}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Lookalike Companies in CRM */}
      {lookalikeCompanies.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
          <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
                <Target size={20} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">CRM Lookalikes</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Other {company.stage} companies in {company.vertical} within your CRM.
                </p>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {lookalikeCompanies.map(c => (
                <div key={c.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-800/30">
                  <h4 className="font-semibold text-slate-900 dark:text-white">{c.name}</h4>
                  <div className="mt-2 text-xs flex gap-2">
                    <span className="px-2 py-1 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                      {c.stage}
                    </span>
                    <span className="px-2 py-1 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                      {c.vertical}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
