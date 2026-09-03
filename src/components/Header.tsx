import React from 'react';
import { Search, Plus, Menu } from 'lucide-react';
import { Company } from '../types';
import { TabType } from './Sidebar';

interface HeaderProps {
  activeTab: TabType;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearchFocused: boolean;
  setIsSearchFocused: (focused: boolean) => void;
  filteredCompanies: Company[];
  setSelectedCompany: (company: Company) => void;
  setIsAddModalOpen: (open: boolean) => void;
  setIsSidebarOpen: (open: boolean) => void;
}

export const Header = React.memo(function Header({
  activeTab,
  searchQuery,
  setSearchQuery,
  isSearchFocused,
  setIsSearchFocused,
  filteredCompanies,
  setSelectedCompany,
  setIsAddModalOpen,
  setIsSidebarOpen
}: HeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-transparent bg-white dark:bg-slate-950 px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 transition-colors duration-200 z-20">
      <div className="flex items-center gap-3 shrink-0">
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white truncate max-w-[140px] sm:max-w-xs md:max-w-none">
          {activeTab === 'crm' && 'Companies'}
          {activeTab === 'signals' && 'Signals'}
          {activeTab === 'sourcing' && 'Sourcing'}
          {activeTab === 'people' && 'People'}
          {activeTab === 'referrals' && 'Referrals'}
          {activeTab === 'dd' && 'Due Diligence (DD)'}
          {activeTab === 'calendar' && 'Events Calendar'}
          {activeTab === 'fundraising' && 'Fundraising CRM'}
        </h2>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2 sm:gap-4 ml-4">
        {['crm', 'dd'].includes(activeTab) && (
          <>
            <div className="relative w-full max-w-[12rem] sm:max-w-[16rem]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 py-2 pl-10 pr-4 text-[0.925rem] focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-100 dark:focus:ring-slate-800/50 dark:focus:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 transition-all shadow-inner"
              />
              {isSearchFocused && searchQuery && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-60 overflow-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 py-2 shadow-xl">
                  {filteredCompanies.length > 0 ? (
                    <>
                      {filteredCompanies.slice(0, 8).map((company) => (
                        <button
                          key={company.id}
                          onClick={() => {
                            setSelectedCompany(company);
                            setSearchQuery('');
                            setIsSearchFocused(false);
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 focus:bg-slate-50 dark:focus:bg-slate-800 focus:outline-none transition-colors"
                        >
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{company.name}</div>
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">{company.stage}</div>
                        </button>
                      ))}
                      {filteredCompanies.length > 8 && (
                        <div className="px-4 py-2 text-xs text-center text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                          + {filteredCompanies.length - 8} more. Keep typing to refine.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400 text-center">No companies found</div>
                  )}{" "}
                </div>
              )}
            </div>
            
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex shrink-0 items-center gap-1.5 sm:gap-2 rounded-lg bg-indigo-600 dark:bg-indigo-500 px-3 sm:px-5 py-2 text-[0.925rem] font-semibold text-white shadow-sm shadow-indigo-200 dark:shadow-none transition-all hover:bg-indigo-700 dark:hover:bg-indigo-600 active:scale-95"
            >
              <Plus size={16} strokeWidth={2.5} />
              <span className="hidden sm:inline">Add Company</span>
              <span className="sm:hidden">Add</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
});
