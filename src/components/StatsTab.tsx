import React, { useMemo, useState, useEffect } from 'react';
import { Company } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { X } from 'lucide-react';
import { useAuth } from './AuthContext';

export const StatsTab = React.memo(function StatsTab({ companies, onNavigateToCRM }: { companies: Company[], onNavigateToCRM?: () => void }) {
  const { user } = useAuth();
  const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
  const isRestrictedUser = Boolean(user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase()));

  const [fundFilter, setFundFilter] = useState<'Total' | 'Stratos OF' | 'Arkansas'>(isRestrictedUser ? 'Arkansas' : 'Total');

  useEffect(() => {
    if (isRestrictedUser) {
      setFundFilter('Arkansas');
    }
  }, [isRestrictedUser]);
  const [selectedCell, setSelectedCell] = useState<{ month: string, stage: string, companies: Company[] } | null>(null);

  const filteredCompanies = useMemo(() => {
    if (fundFilter === 'Total') return companies;
    return companies.filter(c => c.fund === fundFilter || (c.funds && c.funds.includes(fundFilter)));
  }, [companies, fundFilter]);

  // Process data for companies (Sourcing)
  const sourcingData = useMemo(() => {
    // Group by Month (YYYY-MM)
    const dataByMonth: Record<string, { _totalCompanies?: number; companiesByStage?: Record<string, Company[]>; [key: string]: any; }> = {};
    
    filteredCompanies.forEach(comp => {
      // Find the date it was added (first stage history entry, or lastModified)
      let addedStr = comp.lastModified || new Date().toISOString();
      if (comp.stageHistory && comp.stageHistory.length > 0) {
         // get the earliest
         const earliest = [...comp.stageHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
         addedStr = earliest.date;
      }
      
      const addedDateObj = new Date(addedStr);
      // Format to "MMM YYYY"
      const addedMonthLabel = addedDateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      
      if (!dataByMonth[addedMonthLabel]) {
        dataByMonth[addedMonthLabel] = { _totalCompanies: 0, companiesByStage: {} };
      }

      dataByMonth[addedMonthLabel]._totalCompanies = (dataByMonth[addedMonthLabel]._totalCompanies || 0) + 1;

      // Track the month each stage was reached
      
      
      const reachedStagesList: {stage: string, monthLabel: string}[] = [];
      const reachedStagesMap = new Map<string, string>();
      let hasAnalystCall = false;

      if (comp.stageHistory) {
        const sortedHistory = [...comp.stageHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let previousStage = '';
        sortedHistory.forEach(h => {
          const monthLabel = new Date(h.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          
          if (!reachedStagesMap.has(h.stage) || (h.stage === 'Analyst Call' && previousStage !== 'Analyst Call')) {
              reachedStagesMap.set(h.stage, monthLabel);
              reachedStagesList.push({ stage: h.stage, monthLabel });
              if (h.stage === 'Analyst Call') hasAnalystCall = true;
          }
          previousStage = h.stage;
        });
      }
      
      if (comp.stage && !reachedStagesMap.has(comp.stage)) {
        if (comp.stage === 'Analyst Call' && hasAnalystCall) {
            // Already counted Analyst Call from history/interactions, don't fallback add it again
        } else {
            const fallbackMonth = new Date(comp.lastModified || addedStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            reachedStagesMap.set(comp.stage, fallbackMonth);
            reachedStagesList.push({ stage: comp.stage, monthLabel: fallbackMonth });
        }
      }

      
      // Filter out Portfolio Company if not currently
      const finalStages = reachedStagesList.filter(s => s.stage !== 'Portfolio Company' || comp.stage === 'Portfolio Company');

      finalStages.forEach(({ monthLabel, stage }) => {
        if (!dataByMonth[monthLabel]) {
          dataByMonth[monthLabel] = { _totalCompanies: 0, companiesByStage: {} };
        }
        dataByMonth[monthLabel][stage] = (dataByMonth[monthLabel][stage] || 0) + 1;
        
        if (!dataByMonth[monthLabel].companiesByStage![stage]) {
           dataByMonth[monthLabel].companiesByStage![stage] = [];
        }
        dataByMonth[monthLabel].companiesByStage![stage].push(comp);
      });

    });

    const result = Object.keys(dataByMonth).map(monthLabel => {
       // A hardcoded 'remove test data' subtraction of 2 from the Mar 2026
       // DD count used to sit here. It ran for every user, understated a real
       // month permanently, and did not touch the drill-down list — so the
       // cell said 5 while clicking it showed 7 companies.
       
       return {
         month: monthLabel,
         dateObj: new Date(monthLabel),
         ...dataByMonth[monthLabel]
       }
    }).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    
    return result;
  }, [filteredCompanies]);

  const sourcingStages = useMemo(() => {
    return [
      'Initial Review',
      'Analyst Call',
      'Partner Call',
      'DD',
      'Portfolio Company',
      'Watchlist',
      'Passed'
    ];
  }, []);

  const tableStages = useMemo(() => {
    return sourcingStages.filter(stage => stage !== 'Watchlist' && stage !== 'Passed');
  }, [sourcingStages]);

  const stageColors: Record<string, string> = {
    'Initial Review': '#3b82f6', // blue-500
    'Analyst Call': '#8b5cf6', // violet-500
    'Partner Call': '#f59e0b', // amber-500
    'DD': '#f97316', // orange-500
    'Portfolio Company': '#10b981', // emerald-500
  };

  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    tableStages.forEach(stage => {
      totals[stage] = sourcingData.reduce((sum, row) => sum + (row[stage] as number || 0), 0);
    });
    totals['total'] = sourcingData.reduce((sum, row) => sum + ((row['_totalCompanies'] as number) || 0), 0);
    return totals;
  }, [sourcingData, tableStages]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Key Statistics</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Overview of company sourcing progress.</p>
        </div>
        
        <div className="flex items-center gap-1 bg-slate-200/50 dark:bg-slate-800/50 rounded-xl p-1 shadow-inner border border-slate-200 dark:border-slate-800">
          {!isRestrictedUser ? (
            (['Total', 'Stratos OF', 'Arkansas'] as const).map(option => (
              <button
                key={option}
                onClick={() => setFundFilter(option)}
                className={`px-4 py-2 text-[0.925rem] font-semibold rounded-lg transition-all duration-300 ${
                  fundFilter === option 
                    ? 'bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900' 
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-[0.925rem] font-semibold rounded-lg bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900">
              Arkansas Overview
            </div>
          )}
        </div>
      </div>

      {/* Sourcing Stats Section */}
      <div className="bg-white dark:bg-slate-900/50 rounded-3xl p-8 shadow-sm border border-slate-200 dark:border-slate-800">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight mb-4">Company Sourcing Progress</h3>
        
        {/* Color Legend List */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <span className="text-sm font-medium text-slate-500 mr-2">Legend:</span>
          {tableStages.map(stage => (
            <div key={stage} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: stageColors[stage] || '#cbd5e1' }} />
              <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{stage}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="h-[400px] w-full mb-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sourcingData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
              <XAxis dataKey="month" tick={{fill: '#64748b'}} />
              <YAxis tick={{fill: '#64748b'}} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              {tableStages.map((stage) => (
                <Bar key={stage} dataKey={stage} stackId="a" fill={stageColors[stage] || '#cbd5e1'} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Table */}
        <div className="overflow-x-auto mt-8 border border-slate-200 dark:border-slate-700/50 rounded-2xl">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-400 border-collapse">
            <thead className="bg-slate-100/50 dark:bg-slate-800/80 text-slate-900 dark:text-white text-xs uppercase font-bold tracking-wider">
              <tr>
                <th className="px-6 py-4 rounded-tl-2xl">Month</th>
                {tableStages.map((stage, index) => (
                  <th key={stage} className={`px-6 py-4 text-center ${index === tableStages.length - 1 ? 'rounded-tr-2xl' : ''}`}>{stage}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50 bg-white dark:bg-slate-900">
              {sourcingData.map((row, idx) => {
                return (
                  <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{row.month}</td>
                    {tableStages.map(stage => (
                      <td key={stage} className="px-6 py-4 text-center">
                        {stage === 'Portfolio Company' && row[stage] ? (
                          <button 
                            onClick={onNavigateToCRM}
                            className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-blue-300 font-bold hover:underline focus:outline-none transition-colors"
                          >
                            {row[stage]}
                          </button>
                        ) : row[stage] ? (
                          <button
                            onClick={() => setSelectedCell({ month: row.month as string, stage, companies: row.companiesByStage?.[stage] || [] })}
                            className="font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-blue-300 hover:underline focus:outline-none transition-colors"
                          >
                            {row[stage]}
                          </button>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">0</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {sourcingData.length === 0 && (
                <tr>
                  <td colSpan={tableStages.length + 1} className="px-6 py-8 text-center text-slate-500 font-medium">
                    No company data available.
                  </td>
                 </tr>
              )}
            </tbody>
            {sourcingData.length > 0 && (
              <tfoot className="bg-slate-100/80 dark:bg-slate-800 border-t-2 border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white">
                <tr>
                  <td className="px-6 py-4 rounded-bl-2xl">Total</td>
                  {tableStages.map((stage, index) => (
                    <td key={stage} className={`px-6 py-4 text-center ${index === tableStages.length - 1 ? 'rounded-br-2xl' : ''}`}>{columnTotals[stage]}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      
      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm sm:p-6">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-900/10 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{selectedCell.stage}</h3>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">{selectedCell.month} - {selectedCell.companies.length} Companies</p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-200 dark:focus:ring-slate-700"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="overflow-y-auto p-4 flex-1 bg-slate-50/50 dark:bg-slate-900/50">
              {selectedCell.companies.length > 0 ? (
                <div className="space-y-3">
                  {selectedCell.companies.map((company, index) => (
                    <div key={index} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-slate-900 dark:text-white truncate">{company.name}</h4>
                        {company.slogan && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">{company.slogan}</p>}
                      </div>
                      {company.vertical && (
                        <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 shrink-0">
                          {company.vertical}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-3">
                    <span className="text-slate-400 font-medium">0</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 font-medium">No companies details available.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
});
