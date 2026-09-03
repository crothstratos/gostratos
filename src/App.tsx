import React, { useState, Suspense } from 'react';
import { Sidebar, TabType } from './components/Sidebar';
import { Header } from './components/Header';
import { ThemeProvider } from './components/ThemeContext';
import { AuthProvider, useAuth } from './components/AuthContext';
import { Company } from './types';
import { LogIn, Loader2 } from 'lucide-react';
import { useCompanies } from './hooks/useCompanies';
import { databaseId, isProductionData } from './firebase';
import { useEvents } from './hooks/useEvents';

const KanbanBoard = React.lazy(() => import('./components/KanbanBoard').then(module => ({ default: module.KanbanBoard })));
const StatsTab = React.lazy(() => import('./components/StatsTab').then(module => ({ default: module.StatsTab })));
const ReferralsTab = React.lazy(() => import('./components/ReferralsTab').then(module => ({ default: module.ReferralsTab })));
const PeopleTab = React.lazy(() => import('./components/PeopleTab').then(module => ({ default: module.PeopleTab })));
const DueDiligence = React.lazy(() => import('./components/DueDiligence').then(module => ({ default: module.DueDiligence })));
const CalendarView = React.lazy(() => import('./components/CalendarView').then(module => ({ default: module.CalendarView })));
// PortfolioMonitoring is intentionally not routed — see the note at the top
// of that component. Restore this import and its route when it runs on real data.
const FundraisingCRM = React.lazy(() => import('./components/FundraisingCRM').then(module => ({ default: module.FundraisingCRM })));
const InvestorsTab = React.lazy(() => import('./components/InvestorsTab').then(module => ({ default: module.InvestorsTab })));
const SourcingTab = React.lazy(() => import('./components/SourcingTab').then(module => ({ default: module.SourcingTab })));
const SignalsTab = React.lazy(() => import('./components/SignalsTab').then(module => ({ default: module.SignalsTab })));
const ShortlistTab = React.lazy(() => import('./components/ShortlistTab').then(module => ({ default: module.ShortlistTab })));
const SearchTab = React.lazy(() => import('./components/SearchTab').then(module => ({ default: module.SearchTab })));
const CompanyModal = React.lazy(() => import('./components/CompanyModal').then(module => ({ default: module.CompanyModal })));
const AddCompanyModal = React.lazy(() => import('./components/AddCompanyModal').then(module => ({ default: module.AddCompanyModal })));

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { user, isLoading: isAuthLoading, error, login, accessToken } = useAuth();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('crm');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const {
    companies,
    isLoading: isCompaniesLoading,
    handleMoveCompany,
    handleSaveCompany,
    handleAddCompany: originalHandleAddCompany,
    handleDeleteCompany: originalHandleDeleteCompany
  } = useCompanies(user);

  const {
    events,
    handleAddEvent,
    handleUpdateEvent,
    handleDeleteEvent,
    refreshEvents
  } = useEvents(user, accessToken);

  const handleAddCompany = React.useCallback(async (newCompany: Company) => {
    await originalHandleAddCompany(newCompany);
    setIsAddModalOpen(false);
  }, [originalHandleAddCompany]);

  const handleDeleteCompany = React.useCallback(async (companyId: string) => {
    setSelectedCompany(null);
    await originalHandleDeleteCompany(companyId);
  }, [originalHandleDeleteCompany]);

  const filteredCompanies = React.useMemo(() => {
    return companies.filter((company) =>
      company.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [companies, searchQuery]);

  if (isAuthLoading || (user && isCompaniesLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-200 dark:border-slate-800">
          <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <LogIn className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Welcome Back</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8">
            Sign in to access your investment pipeline and CRM.
          </p>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-left">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">Authentication Error</p>
              <p className="text-xs text-red-500 dark:text-red-300 mb-2">{error}</p>
              {error.includes('unauthorized-domain') && (
                <p className="text-xs text-red-500 dark:text-red-300 mt-2">
                  <strong>Fix:</strong> Add <code>{window.location.hostname}</code> to the <strong>Authorized domains</strong> list in your Firebase Console (Authentication &gt; Settings &gt; Authorized domains).
                </p>
              )}
            </div>
          )}

          <button
            onClick={login}
            className="w-full flex items-center justify-center px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans dark:bg-slate-950 dark:text-slate-100 transition-colors duration-200">
      {/* Unmissable when the app is pointed at anything other than production.
          The quickest way to cause an incident with a staging environment is
          forgetting which one you are looking at. */}
      {!isProductionData && (
        <div className="fixed inset-x-0 top-0 z-[100] bg-amber-500 px-4 py-1 text-center text-[12px] font-semibold text-amber-950">
          NOT PRODUCTION — connected to the "{databaseId}" database. Changes here do not affect the live CRM.
        </div>
      )}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden h-screen">
        <Header
          activeTab={activeTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isSearchFocused={isSearchFocused}
          setIsSearchFocused={setIsSearchFocused}
          filteredCompanies={filteredCompanies}
          setSelectedCompany={setSelectedCompany}
          setIsAddModalOpen={setIsAddModalOpen}
          setIsSidebarOpen={setIsSidebarOpen}
        />

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          }>
            {activeTab === 'crm' && (
              <KanbanBoard
                companies={companies}
                onMoveCompany={handleMoveCompany}
                onCompanyClick={setSelectedCompany}
                onSaveCompany={handleSaveCompany}
              />
            )}
            {activeTab === 'stats' && <StatsTab companies={companies} onNavigateToCRM={() => setActiveTab('crm')} />}
            {activeTab === 'referrals' && <ReferralsTab companies={companies} onCompanyClick={setSelectedCompany} />}
            {activeTab === 'people' && <PeopleTab onCompanyClick={setSelectedCompany} />}
            {activeTab === 'dd' && <DueDiligence companies={companies} onUpdateCompany={handleSaveCompany} />}
            {activeTab === 'calendar' && (
              <CalendarView
                events={events}
                onAddEvent={handleAddEvent}
                onUpdateEvent={handleUpdateEvent}
                onDeleteEvent={handleDeleteEvent}
                currentUser={user}
              />
            )}
            {activeTab === 'fundraising' && <FundraisingCRM />}
            {activeTab === 'investors' && <InvestorsTab onCompanyClick={setSelectedCompany} />}
            {activeTab === 'signals' && (
              <SignalsTab companies={companies} onCompanyClick={setSelectedCompany} />
            )}
            {activeTab === 'sourcing' && (
              <SourcingTab companies={companies} onAddCompany={handleAddCompany} />
            )}
            {activeTab === 'shortlist' && <ShortlistTab companies={companies} onCompanyClick={setSelectedCompany} onUpdateCompany={handleSaveCompany} />}
            {activeTab === 'search' && <SearchTab companies={companies} />}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        {selectedCompany && (
          <CompanyModal
            company={selectedCompany}
            companies={companies}
            onCompanyClick={setSelectedCompany}
            onClose={() => setSelectedCompany(null)}
            onSave={handleSaveCompany}
            onDelete={handleDeleteCompany}
            onAddEvent={handleAddEvent}
            onRefreshEvents={refreshEvents}
          />
        )}

        {isAddModalOpen && (
          <AddCompanyModal
            onClose={() => setIsAddModalOpen(false)}
            onAdd={handleAddCompany}
            companies={companies}
          />
        )}
      </Suspense>
    </div>
  );
}
