/**
 * NOT CURRENTLY REACHABLE FROM THE APP — deliberately disconnected.
 *
 * This component displays hardcoded sample data under whichever real
 * portfolio company is selected. Before it is re-enabled, every one of these
 * must be replaced with values read from the company record:
 *
 *   - Total Invested, Ownership %, MoIC          (module constants)
 *   - Cash on hand, monthly burn, runway         (module constants, so the
 *                                                 red "4.5 months" badge fires
 *                                                 for every company forever)
 *   - The burn alert banner                      (computed from constants,
 *                                                 so it is permanently on)
 *   - Revenue and headcount charts               (module constants)
 *   - Cap table, liquidation preference          (module constants)
 *   - Board minutes, reporting compliance        (static text)
 *   - Deal lead name                             (hardcoded, not a real
 *                                                 team member)
 *
 * Two specific hazards:
 *   1. The exit calculator multiplies exit values the user TYPES AND SAVES by
 *      a hardcoded 12.5% ownership and $2.5m cost basis, and ignores the
 *      liquidation preference shown alongside it. Real input, invented math.
 *   2. "Upload Financials" reads the chosen file, discards it, waits two
 *      seconds and swaps in a second hardcoded dataset, so it appears to have
 *      worked. The grid is also editable with no save handler, so edits are
 *      lost on tab change.
 *
 * Kept in the repository because the layout is worth reusing.
 */
import React, { useState } from 'react';
import { Company } from '../types';
import { cn } from '../utils';
import { Building2, ChevronDown, User, Clock, Download, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, DollarSign, Users, Bell, UploadCloud, Upload, Activity } from 'lucide-react';
import { useTheme } from './ThemeContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, ClientSideRowModelModule, ValidationModule, RowSelectionModule, CellStyleModule, NumberEditorModule, TextEditorModule } from 'ag-grid-community';

ModuleRegistry.registerModules([
  ClientSideRowModelModule, 
  ValidationModule,
  RowSelectionModule,
  CellStyleModule,
  NumberEditorModule,
  TextEditorModule
]);

type PortfolioTab = 'Dashboard' | 'Financials' | 'Cap Table & Exit' | 'Support & Value-Add' | 'Reporting Status';

const CHART_DATA = [
  { month: 'Jan', revenue: 120000, burn: 80000, headcount: 12 },
  { month: 'Feb', revenue: 135000, burn: 85000, headcount: 14 },
  { month: 'Mar', revenue: 142000, burn: 90000, headcount: 15 },
  { month: 'Apr', revenue: 155000, burn: 95000, headcount: 16 },
  { month: 'May', revenue: 160000, burn: 120000, headcount: 18 }, // Burn increased by >20% (95k -> 120k is 26%), Revenue (155k -> 160k is 3%)
  { month: 'Jun', revenue: 180000, burn: 125000, headcount: 20 },
];

import { ColDef } from 'ag-grid-community';

const FINANCIAL_ROW_DATA = [
  { metric: 'Revenue', jan: 120000, feb: 135000, mar: 142000, apr: 155000, may: 160000, jun: 180000, budget: 150000, variance: 30000 },
  { metric: 'Gross Margin %', jan: 75, feb: 76, mar: 75, apr: 77, may: 74, jun: 76, budget: 75, variance: 1 },
  { metric: 'EBITDA', jan: -20000, feb: -15000, mar: -10000, apr: -5000, may: -30000, jun: -10000, budget: -15000, variance: 5000 },
  { metric: 'Cash Balance', jan: 2000000, feb: 1985000, mar: 1975000, apr: 1970000, may: 1940000, jun: 1930000, budget: 1900000, variance: 30000 },
];

const FINANCIAL_COL_DEFS: ColDef<any>[] = [
  { field: 'metric', headerName: 'Metric', pinned: 'left', width: 150, cellStyle: { fontWeight: 'bold' } },
  { field: 'jan', headerName: 'Jan', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'feb', headerName: 'Feb', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'mar', headerName: 'Mar', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'apr', headerName: 'Apr', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'may', headerName: 'May', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'jun', headerName: 'Jun', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { field: 'budget', headerName: 'Budget (Jun)', editable: true, valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value },
  { 
    field: 'variance', 
    headerName: 'Variance', 
    valueFormatter: (p: any) => p.value > 1000 ? `$${(p.value/1000).toFixed(0)}k` : p.value,
    cellStyle: (params: any) => {
      if (params.value > 0) return { color: '#10B981', fontWeight: 'bold' };
      if (params.value < 0) return { color: '#EF4444', fontWeight: 'bold' };
      return null;
    }
  },
];

export const PortfolioMonitoring = React.memo(function PortfolioMonitoring({ companies, onUpdateCompany }: { companies: Company[], onUpdateCompany: (company: Company) => void }) {
  const { theme } = useTheme();
  const portfolioCompanies = companies.filter(c => c.stage === 'Portfolio Company');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(portfolioCompanies[0]?.id || '');
  const [activeTab, setActiveTab] = useState<PortfolioTab>('Dashboard');
  const [financialData, setFinancialData] = useState(FINANCIAL_ROW_DATA);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  React.useEffect(() => {
    if (portfolioCompanies.length > 0 && !portfolioCompanies.find(c => c.id === selectedCompanyId)) {
      setSelectedCompanyId(portfolioCompanies[0].id);
    }
  }, [portfolioCompanies, selectedCompanyId]);

  const selectedCompany = portfolioCompanies.find(c => c.id === selectedCompanyId);

  const healthStatus = selectedCompany?.portfolioHealth || 'Stable';
  const exitScenarios = selectedCompany?.portfolioExitScenarios || [
    { id: 1, value: 100000000 },
    { id: 2, value: 500000000 },
  ];

  const handleUpdate = (updates: Partial<Company>) => {
    if (!selectedCompany) return;
    onUpdateCompany({ ...selectedCompany, ...updates });
  };

  // Mock calculations
  const cashOnHand = 450000;
  const avgMonthlyBurn = 100000;
  const runwayMonths = cashOnHand / avgMonthlyBurn;
  const isRunwayLow = runwayMonths < 6;

  // Check for Burn increase > 20% without Revenue increase > 10%
  const checkBurnAlert = () => {
    if (CHART_DATA.length < 3) return false;
    const last = CHART_DATA[CHART_DATA.length - 2]; // Let's check May vs Apr
    const prev = CHART_DATA[CHART_DATA.length - 3];
    
    if (!last || !prev) return false;

    const burnIncrease = (last.burn - prev.burn) / prev.burn;
    const revIncrease = (last.revenue - prev.revenue) / prev.revenue;
    
    return burnIncrease > 0.20 && revIncrease < 0.10;
  };
  const hasBurnAlert = checkBurnAlert();

  const handleGenerateLPUpdate = () => {
    alert('Generating LP Update PDF with latest charts and board minutes...');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    // Simulate AI/backend analysis
    setTimeout(() => {
      setIsAnalyzing(false);
      // Update with some new "analyzed" data
      setFinancialData([
        { metric: 'Revenue', jan: 125000, feb: 140000, mar: 150000, apr: 160000, may: 175000, jun: 190000, budget: 150000, variance: 40000 },
        { metric: 'Gross Margin %', jan: 76, feb: 77, mar: 76, apr: 78, may: 75, jun: 78, budget: 75, variance: 3 },
        { metric: 'EBITDA', jan: -15000, feb: -10000, mar: -5000, apr: 0, may: -20000, jun: 5000, budget: -15000, variance: 20000 },
        { metric: 'Cash Balance', jan: 2000000, feb: 1990000, mar: 1985000, apr: 1985000, may: 1965000, jun: 1970000, budget: 1900000, variance: 70000 },
      ]);
    }, 2000);
  };

  if (!selectedCompany) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        No companies available for Portfolio Monitoring.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* The "Investment Vitals" Header */}
      <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm transition-colors duration-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#0A192F] text-white shadow-sm">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  className="appearance-none bg-transparent text-xl font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  {portfolioCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="text-slate-400 dark:text-slate-500" />
                <select
                  className="appearance-none rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer whitespace-nowrap transition-colors"
                  defaultValue="Series A"
                >
                  <option value="Pre-Seed">Pre-Seed</option>
                  <option value="Seed">Seed</option>
                  <option value="Series A">Series A</option>
                  <option value="Series B">Series B</option>
                  <option value="Series C">Series C</option>
                  <option value="IPO">IPO</option>
                </select>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><User size={14} /> Lead: Alex Mercer</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-8">
            {/* Ownership Stats */}
            <div className="flex gap-6 text-sm">
              <div className="flex flex-col">
                <span className="text-slate-500 dark:text-slate-400 font-medium text-xs uppercase tracking-wider whitespace-nowrap">Total Invested</span>
                <span className="font-bold text-slate-900 dark:text-white">$2.5M</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 dark:text-slate-400 font-medium text-xs uppercase tracking-wider whitespace-nowrap">Ownership</span>
                <span className="font-bold text-slate-900 dark:text-white">12.5%</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 dark:text-slate-400 font-medium text-xs uppercase tracking-wider whitespace-nowrap">Current MoIC</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">2.4x</span>
              </div>
            </div>

            <div className="h-10 w-px bg-slate-200 dark:bg-slate-700" />

            {/* Runway Clock */}
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 font-bold shadow-sm border transition-colors",
              isRunwayLow 
                ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20" 
                : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20"
            )}>
              <Clock size={18} />
              <span>Est. Runway: {runwayMonths.toFixed(1)} Months</span>
            </div>

            <button
              onClick={handleGenerateLPUpdate}
              className="flex items-center gap-2 rounded-lg bg-[#0A192F] dark:bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#112240] dark:hover:bg-indigo-700"
            >
              <Download size={16} />
              Generate LP Update
            </button>
          </div>
        </div>

        {/* Automated Flagging System (The "Red Alerts") */}
        {hasBurnAlert && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-500/10 p-3 text-sm font-medium text-red-800 dark:text-red-400 border border-red-200 dark:border-red-500/20 transition-colors">
            <AlertTriangle size={16} className="text-red-600 dark:text-red-500" />
            <strong>Alert:</strong> Burn increased by &gt;20% month-over-month without a corresponding 10% increase in revenue.
          </div>
        )}
      </div>

      {/* Horizontal Navigation Tabs */}
      <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 transition-colors duration-200">
        <nav className="flex space-x-8">
          {(['Dashboard', 'Financials', 'Cap Table & Exit', 'Support & Value-Add', 'Reporting Status'] as PortfolioTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "border-b-2 py-4 text-sm font-medium transition-colors",
                activeTab === tab
                  ? "border-[#0A192F] dark:border-indigo-400 text-[#0A192F] dark:text-indigo-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden p-6">
        {activeTab === 'Dashboard' && (
          <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2 pb-8">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">The Cockpit</h3>
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded-lg p-1 border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-200">
                <button
                  onClick={() => handleUpdate({ portfolioHealth: 'Stable' })}
                  className={cn("px-3 py-1 text-xs font-bold rounded-md transition-colors", healthStatus === 'Stable' ? "bg-slate-800 dark:bg-slate-700 text-white" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Stable
                </button>
                <button
                  onClick={() => handleUpdate({ portfolioHealth: 'At Risk' })}
                  className={cn("px-3 py-1 text-xs font-bold rounded-md transition-colors", healthStatus === 'At Risk' ? "bg-red-600 text-white" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  At Risk
                </button>
                <button
                  onClick={() => handleUpdate({ portfolioHealth: 'Hypergrowth' })}
                  className={cn("px-3 py-1 text-xs font-bold rounded-md transition-colors", healthStatus === 'Hypergrowth' ? "bg-emerald-600 text-white" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Hypergrowth
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Revenue Chart */}
              <div className="col-span-1 md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col min-h-[300px] transition-colors duration-200">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <TrendingUp size={16} /> Revenue (LTM) vs Burn
                </h4>
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="99%" height="100%" minHeight={1} minWidth={1}>
                    <AreaChart data={CHART_DATA} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorBurn" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{fontSize: 12, fill: '#94a3b8'}} tickLine={false} axisLine={false} />
                      <YAxis tick={{fontSize: 12, fill: '#94a3b8'}} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value/1000}k`} />
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                      <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                      <Legend />
                      <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" />
                      <Area type="monotone" dataKey="burn" name="Monthly Burn" stroke="#EF4444" strokeWidth={2} fillOpacity={1} fill="url(#colorBurn)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Headcount Chart */}
              <div className="col-span-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col min-h-[300px] transition-colors duration-200">
                <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <Users size={16} /> Headcount Growth
                </h4>
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="99%" height="100%" minHeight={1} minWidth={1}>
                    <BarChart data={CHART_DATA} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{fontSize: 12, fill: '#94a3b8'}} tickLine={false} axisLine={false} />
                      <YAxis tick={{fontSize: 12, fill: '#94a3b8'}} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                      <Bar dataKey="headcount" name="Employees" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Financials' && (
          <div className="flex h-full flex-col gap-4">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Financial Data Grid</h3>
            
            {/* Upload Zone */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors duration-200">
              <div className="flex items-center gap-4 mb-4 sm:mb-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <UploadCloud size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Upload Financials</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Upload CSV or Excel files to auto-populate the grid below.</p>
                </div>
              </div>
              <div className="relative">
                <input
                  type="file"
                  accept=".csv, .xlsx, .xls"
                  onChange={handleFileUpload}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  disabled={isAnalyzing}
                />
                <button
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 dark:bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-70"
                >
                  {isAnalyzing ? (
                    <><Activity className="animate-pulse" size={16} /> Analyzing...</>
                  ) : (
                    <><Upload size={16} /> Select File</>
                  )}
                </button>
              </div>
            </div>

            <div className={cn("flex-1 w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm", theme === 'dark' ? "ag-theme-alpine-dark" : "ag-theme-alpine")}>
              {/* Note: In a real app, you'd dynamically switch ag-grid themes based on the context. 
                  For now, we'll rely on the global CSS or just use the default if not fully configured. */}
              <AgGridReact
                theme="legacy"
                rowData={financialData}
                columnDefs={FINANCIAL_COL_DEFS}
                defaultColDef={{
                  flex: 1,
                  minWidth: 100,
                  resizable: true,
                }}
                rowSelection="multiple"
              />
            </div>
          </div>
        )}

        {activeTab === 'Cap Table & Exit' && (
          <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2 pb-8">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Cap Table & Exit Scenarios</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors duration-200">
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-4">Current Structure</h4>
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Total Outstanding Shares</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">10,000,000</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Stratos Shares (Series A)</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">1,250,000</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Liquidation Preference</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">1x Non-Participating</span>
                  </div>
                </div>
              </div>
              
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors duration-200">
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-4">"What-If" Exit Scenarios</h4>
                <div className="space-y-4">
                  {exitScenarios.map((scenario, index) => {
                    const ourReturn = scenario.value * 0.125; // 12.5% ownership
                    const multiple = ourReturn / 2500000; // $2.5M invested
                    
                    return (
                      <div key={scenario.id} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 border border-slate-100 dark:border-slate-700 transition-colors">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Exit Value</span>
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-800 dark:text-slate-200">$</span>
                            <input
                              type="number"
                              value={scenario.value}
                              onChange={(e) => {
                                const newScenarios = [...exitScenarios];
                                newScenarios[index].value = Number(e.target.value);
                                handleUpdate({ portfolioExitScenarios: newScenarios });
                              }}
                              className="font-bold text-slate-800 dark:text-slate-200 bg-transparent w-24 focus:outline-none focus:border-b border-slate-300 dark:border-slate-600"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Our Return</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            ${(ourReturn / 1000000).toFixed(1)}M ({multiple.toFixed(1)}x)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Support & Value-Add' && (
          <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2 pb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors duration-200">
                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><Bell size={18} className="text-indigo-500 dark:text-indigo-400"/> Founder Requests</h4>
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">VP of Sales Intro</span>
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">Pending</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Looking for a seasoned VP of Sales with FinTech experience to scale from $1M to $10M ARR.</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Series B Deck Review</span>
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">Completed</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Provided feedback on the narrative and financial model for the upcoming raise.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors duration-200">
                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><Clock size={18} className="text-indigo-500 dark:text-indigo-400"/> Board Meeting Minutes</h4>
                <div className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-3 pl-4 space-y-6">
                  <div className="relative">
                    <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-indigo-500 dark:bg-indigo-400 ring-4 ring-white dark:ring-slate-900" />
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Q2 2024 - June 15</span>
                    <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-300">Approved revised budget. Focus shifting to enterprise segment.</p>
                  </div>
                  <div className="relative">
                    <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-600 ring-4 ring-white dark:ring-slate-900" />
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Q1 2024 - March 10</span>
                    <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-300">Product launch successful. Discussed hiring plan for engineering.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Reporting Status' && (
          <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2 pb-8">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm max-w-2xl transition-colors duration-200">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Reporting Compliance</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="text-emerald-500 dark:text-emerald-400" size={24} />
                    <div>
                      <h4 className="font-bold text-emerald-900 dark:text-emerald-400">Q2 2024 Financials</h4>
                      <p className="text-xs text-emerald-700 dark:text-emerald-500">Submitted on July 5, 2024</p>
                    </div>
                  </div>
                  <button className="text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 underline">View Report</button>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="text-red-500 dark:text-red-400" size={24} />
                    <div>
                      <h4 className="font-bold text-red-900 dark:text-red-400">July 2024 Monthly Update</h4>
                      <p className="text-xs text-red-700 dark:text-red-500">Overdue by 5 days</p>
                    </div>
                  </div>
                  <button className="rounded-lg bg-red-600 dark:bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:hover:bg-red-600 shadow-sm">
                    Nudge Founder
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
