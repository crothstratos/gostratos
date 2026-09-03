import React from 'react';
import { Briefcase, LayoutDashboard, SearchCode, FileSearch, Calendar as CalendarIcon, LineChart, Moon, Sun, Users, LogOut, X, Star, Share2, Contact2, Compass } from 'lucide-react';
import { cn } from '../utils';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';
import { StratosLogo } from './StratosLogo';

export type TabType = 'crm' | 'stats' | 'sourcing' | 'people' | 'referrals' | 'dd' | 'calendar' | 'portfolio' | 'fundraising' | 'investors' | 'shortlist' | 'search';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const Sidebar = React.memo(function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 flex h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="flex flex-col items-center justify-center border-b border-slate-100 dark:border-slate-800/50 p-6 relative">
          <StratosLogo className="h-10 w-auto" />
          <button 
            onClick={() => setIsOpen(false)}
            className="absolute right-4 top-6 lg:hidden p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="flex-1 space-y-1.5 p-4 overflow-y-auto">
          <button
            onClick={() => { setActiveTab('crm'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'crm' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <LayoutDashboard size={16} className={activeTab === 'crm' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Companies
          </button>
          <button
            onClick={() => { setActiveTab('stats'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'stats' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <LineChart size={16} className={activeTab === 'stats' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Stats
          </button>
          <button
            onClick={() => { setActiveTab('sourcing'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'sourcing' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Compass size={16} className={activeTab === 'sourcing' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Sourcing
          </button>
          <button
            onClick={() => { setActiveTab('people'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'people' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Contact2 size={16} className={activeTab === 'people' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            People
          </button>
          <button
            onClick={() => { setActiveTab('referrals'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'referrals' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Share2 size={16} className={activeTab === 'referrals' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Referrals
          </button>
          <button
            onClick={() => { setActiveTab('shortlist'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'shortlist' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Star size={16} className={activeTab === 'shortlist' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Shortlist
          </button>
          <button
            onClick={() => { setActiveTab('search'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'search' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <SearchCode size={16} className={activeTab === 'search' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Search
          </button>
          <button
            onClick={() => { setActiveTab('dd'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'dd' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <FileSearch size={16} className={activeTab === 'dd' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Due Diligence (DD)
          </button>
          <button
            onClick={() => { setActiveTab('calendar'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'calendar' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <CalendarIcon size={16} className={activeTab === 'calendar' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Calendar
          </button>
          {/* Portfolio Monitoring is hidden until it runs on real data. The
              component is still in the repo; see the note at the top of
              PortfolioMonitoring.tsx before re-enabling this. */}
          <button
            onClick={() => { setActiveTab('fundraising'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'fundraising' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Users size={16} className={activeTab === 'fundraising' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Fundraising
          </button>
          <button
            onClick={() => { setActiveTab('investors'); setIsOpen(false); }}
            className={cn(
              "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
              activeTab === 'investors' ? "bg-white text-slate-900 shadow-sm before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-indigo-600 dark:bg-slate-800 dark:text-white dark:before:bg-indigo-400" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            <Briefcase size={16} className={activeTab === 'investors' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} />
            Investors
          </button>
        </nav>

        <div className="p-4 border-t border-slate-200/80 dark:border-slate-800/50 space-y-2 bg-slate-50/50 dark:bg-slate-900/50">
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              {user.picture ? (
                <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full ring-2 ring-white dark:ring-slate-800 shadow-sm" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-bold ring-2 ring-white dark:ring-slate-800 shadow-sm">
                  {user.name.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate tracking-tight">{user.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-white hover:shadow-sm hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-all duration-200"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
          {user && (
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 hover:shadow-sm dark:text-red-400 dark:hover:bg-red-900/20 transition-all duration-200"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          )}
        </div>
      </aside>
    </>
  );
});
