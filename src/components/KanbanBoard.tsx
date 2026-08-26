import React, { useState, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Company, Stage, STAGES } from '../types';
import { cn, formatLocation, getFundColorClass } from '../utils';
import { Download, FileText, FileSpreadsheet, MapPin, Globe, MessageSquare, Sparkles } from 'lucide-react';



import { MapModal } from './MapModal';
import { useGemini } from '../hooks/useGemini';

interface KanbanBoardProps {
  companies: Company[];
  onMoveCompany: (companyId: string, newStage: Stage) => void;
  onCompanyClick: (company: Company) => void;
  onSaveCompany?: (company: Company) => Promise<void> | void;
}

const CompanyCard = React.memo(function CompanyCard({
  company,
  index,
  onCompanyClick,
  getVerticalColor
}: {
  company: Company;
  index: number;
  onCompanyClick: (company: Company) => void;
  getVerticalColor: (vertical: string) => string;
}) {
  return (
    <Draggable
      // @ts-ignore - React 19 types issue with hello-pangea/dnd
      key={company.id}
      draggableId={company.id}
      index={index}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onCompanyClick(company)}
          className={cn(
            "group relative flex cursor-pointer flex-col gap-2.5 rounded-xl border border-transparent bg-white dark:bg-slate-900 p-4 shadow-sm shadow-slate-200/50 dark:shadow-none transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800",
            snapshot.isDragging ? "shadow-xl ring-2 ring-slate-900 ring-opacity-20 dark:ring-white/20 scale-[1.02] rotate-1 z-50" : ""
          )}
        >
          <div className="flex items-start justify-between gap-2 min-w-0">
            <h4 className="font-semibold text-[0.95rem] tracking-tight text-slate-900 dark:text-white truncate flex-1 transition-colors">{company.name}</h4>
          </div>
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400 truncate w-full"
              onClick={(e) => e.stopPropagation()}
              title={company.website}
            >
              {company.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          {company.location && (
            <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5 min-w-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin shrink-0"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              <span className="truncate">{formatLocation(company.location)}</span>
            </p>
          )}
          <p className="line-clamp-2 text-sm text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 leading-relaxed">
            {company.slogan || company.basics || 'No description provided'}
          </p>
          {(company.interactions && company.interactions.length > 0) && (
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                Last Interaction ({new Date(company.interactions[0].date).toLocaleDateString()})
              </div>
              <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400 italic">
                {company.interactions[0].notes || company.interactions[0].type}
              </p>
            </div>
          )}
          {(company.vertical || company.fund || (company.funds && company.funds.length > 0)) && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {company.vertical && (
                <span className={cn(
                  "inline-flex items-center rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider shrink-0 transition-colors",
                  getVerticalColor(company.vertical)
                )}>
                  {company.vertical}
                </span>
              )}
              {company.fund && !(company.funds && company.funds.length > 0) && (
                <span className={cn(
                  "inline-flex items-center rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider shrink-0",
                  getFundColorClass(company.fund)
                )}>
                  {company.fund}
                </span>
              )}
              {company.funds && company.funds.map(f => (
                <span key={f} className={cn(
                  "inline-flex items-center rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider shrink-0",
                  getFundColorClass(f)
                )}>
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
});

export const KanbanBoard = React.memo(function KanbanBoard({ companies, onMoveCompany, onCompanyClick, onSaveCompany }: KanbanBoardProps) {
  const [locationFilter, setLocationFilter] = useState<string>('All Locations');
  const [fundFilter, setFundFilter] = useState<string>('All Funds');
  const [verticalFilter, setVerticalFilter] = useState<string>('All Verticals');
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  const { handleDiscoverCoinvestors } = useGemini();
  const [isBulkDiscovering, setIsBulkDiscovering] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  const runBulkDiscover = async () => {
    if (!onSaveCompany) return;
    setIsBulkDiscovering(true);
    
    // Process only companies that don't have aiCoInvestors yet
    const toProcess = companies.filter(c => !c.aiCoInvestors || c.aiCoInvestors.length === 0);
    setBulkProgress({ current: 0, total: toProcess.length });
    
    for (let i = 0; i < toProcess.length; i++) {
      const c = toProcess[i];
      setBulkProgress(prev => ({ ...prev, current: i + 1 }));
      try {
        await new Promise<void>((resolve, reject) => {
          handleDiscoverCoinvestors(
            c.name || '',
            c.basics || c.companySolution || '',
            c.vertical || '',
            async (data) => {
              if (data && data.investors) {
                await onSaveCompany({ ...c, aiCoInvestors: data.investors });
              }
              resolve();
            },
            (err) => {
              console.error("AI Discover error for " + c.name, err);
              resolve(); // Resolve anyway so it moves to next company
            }
          );
        });
        // Add a delay to avoid rate limits (4 seconds)
        await new Promise(r => setTimeout(r, 4000));
      } catch (err) {
        console.error("Failed to discover for " + c.name, err);
      }
    }
    
    setIsBulkDiscovering(false);
  };


  const locations = useMemo(() => {
    const locs = new Set<string>();
    companies.forEach(c => {
       const locStr = formatLocation(c.location);
       if (locStr) locs.add(locStr);
    });
    return ['All Locations', ...Array.from(locs).sort()];
  }, [companies]);

  const verticals = useMemo(() => {
    const verts = new Set<string>();
    companies.forEach(c => {
      if (c.vertical) verts.add(c.vertical);
    });
    return ['All Verticals', ...Array.from(verts).sort()];
  }, [companies]);

  const filteredCompanies = useMemo(() => {
    return companies.filter(c => {
      const locMatch = locationFilter === 'All Locations' || formatLocation(c.location) === locationFilter;
      const fundMatch = fundFilter === 'All Funds' || c.fund === fundFilter || (c.funds && c.funds.includes(fundFilter));
      const verticalMatch = verticalFilter === 'All Verticals' || c.vertical === verticalFilter;
      return locMatch && fundMatch && verticalMatch;
    });
  }, [companies, locationFilter, fundFilter, verticalFilter]);

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    onMoveCompany(draggableId, destination.droppableId as Stage);
  };

  const getVerticalColor = React.useCallback((vertical: string) => {
    switch (vertical) {
      case 'Fintech':
        return 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-400 dark:ring-green-500/20';
      case 'Insurtech':
        return 'bg-slate-50 text-indigo-700 ring-blue-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-blue-500/20';
      case 'Regtech':
        return 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
      case 'Healthtech':
        return 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20';
      case 'Supply Chain':
        return 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
      case 'MarTech':
        return 'bg-pink-50 text-pink-700 ring-pink-600/20 dark:bg-pink-500/10 dark:text-pink-400 dark:ring-pink-500/20';
      case 'Ag Tech':
        return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
      case 'Business Productivity Software':
        return 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20';
      case 'PropTech':
        return 'bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20';
      case 'Other':
      default:
        return 'bg-slate-50 text-slate-900 ring-slate-600/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20';
    }
  }, []);

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    
    // Sort by stage
    const data = [...filteredCompanies]
      .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage))
      .map(c => ({
        'Company Name': c.name,
        'Stage': c.stage,
        'Vertical': c.vertical || '',
        'Location': formatLocation(c.location),
        'Website': c.website || '',
        'Revenue': c.revenue || '',
        'Basics': c.basics || '',
        'Last Interaction Date': (c.interactions?.length || 0) > 0 ? new Date(c.interactions![0].date).toLocaleDateString() : 'None',
        'Last Interaction Notes': (c.interactions?.length || 0) > 0 ? c.interactions![0].notes : ''
      }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "CRM Export");
    XLSX.writeFile(wb, "CRM_Companies_Export.xlsx");
  };

  const exportToPDF = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    doc.text("CRM Companies by Stage", 14, 15);
    
    const tableData = [...filteredCompanies]
      .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage))
      .map(c => [
        c.name,
        c.stage,
        c.vertical || '',
        formatLocation(c.location),
        (c.interactions?.length || 0) > 0 ? new Date(c.interactions![0].date).toLocaleDateString() : 'None'
      ]);

    autoTable(doc, {
      startY: 20,
      head: [['Company Name', 'Stage', 'Vertical', 'Location', 'Last Interaction']],
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] }
    });
    
    doc.save("CRM_Companies_Export.pdf");
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Filtering and Actions Bar */}
      <div className="flex flex-col sm:flex-row p-4 min-h-[64px] items-start sm:items-center justify-between gap-4 bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2 max-w-xs w-full sm:w-auto">
            <button
              onClick={() => setIsMapModalOpen(true)}
              className="p-2 bg-slate-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-blue-900/50 rounded-lg hidden sm:flex transition-colors cursor-pointer"
              title="View on Map"
            >
              <MapPin className="w-5 h-5" />
            </button>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="w-full sm:w-64 appearance-none rounded-lg border border-slate-200 bg-white/50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white transition-all shadow-sm"
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc} {loc === 'All Locations' ? `(${companies.length})` : `(${companies.filter(c => formatLocation(c.location) === loc).length})`}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2 max-w-xs w-full sm:w-auto">
            <select
              value={fundFilter}
              onChange={(e) => setFundFilter(e.target.value)}
              className="w-full sm:w-48 appearance-none rounded-lg border border-slate-200 bg-white/50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white transition-all shadow-sm"
            >
              <option value="All Funds">All Funds ({companies.length})</option>
              <option value="Arkansas">Arkansas ({companies.filter(c => c.fund === 'Arkansas' || (c.funds && c.funds.includes('Arkansas'))).length})</option>
              <option value="Stratos OF">Stratos OF ({companies.filter(c => c.fund === 'Stratos OF' || (c.funds && c.funds.includes('Stratos OF'))).length})</option>
            </select>
            <select
              value={verticalFilter}
              onChange={(e) => setVerticalFilter(e.target.value)}
              className="w-full sm:w-48 appearance-none rounded-lg border border-slate-200 bg-white/50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white transition-all shadow-sm"
            >
              {verticals.map((vert) => (
                <option key={vert} value={vert}>
                  {vert} {vert === 'All Verticals' ? `(${companies.length})` : `(${companies.filter(c => c.vertical === vert).length})`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mr-2 whitespace-nowrap">
            Export:
          </div>
          
          {onSaveCompany && (
            <button
              onClick={runBulkDiscover}
              disabled={isBulkDiscovering}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 border border-fuchsia-200 rounded-lg transition-colors dark:bg-fuchsia-900/20 dark:text-fuchsia-400 dark:border-fuchsia-800/50 dark:hover:bg-fuchsia-900/40 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {isBulkDiscovering ? (
                <>
                  <div className="w-4 h-4 border-2 border-fuchsia-400 border-t-transparent rounded-full animate-spin" />
                  {bulkProgress.current} / {bulkProgress.total}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Bulk AI Discover
                </>
              )}
            </button>
          )}
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/50 dark:hover:bg-emerald-900/40 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800/50 dark:hover:bg-rose-900/40 whitespace-nowrap shrink-0"
          >
            <FileText className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-6 pb-4 min-w-max flex-1 items-start">
          {STAGES.map((stage, index) => {
            const stageCompanies = filteredCompanies.filter((c) => c.stage === stage);

            return (
              <React.Fragment key={stage}>
                <div
                  className="flex w-80 flex-shrink-0 flex-col rounded-3xl bg-slate-100/60 dark:bg-slate-800/30 border border-slate-200/50 dark:border-slate-700/40 p-4 transition-colors duration-200 h-full max-h-[85vh] overflow-hidden shadow-sm"
                >
                  <div className="mb-4 flex items-center justify-between pb-2 shrink-0">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 tracking-tight">{stage}</h3>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200/80 dark:bg-slate-700/80 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {stageCompanies.length}
                  </span>
                </div>

                <Droppable droppableId={stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "flex-1 rounded-xl transition-colors p-1 -mx-1 overflow-y-auto",
                        snapshot.isDraggingOver ? "bg-slate-200/50 dark:bg-slate-800/50" : ""
                      )}
                    >
                      <div className="flex flex-col gap-3 min-h-full pb-2">
                        {stageCompanies.slice(0, 50).map((company, index) => (
                          <CompanyCard
                            key={company.id}
                            company={company}
                            index={index}
                            onCompanyClick={onCompanyClick}
                            getVerticalColor={getVerticalColor}
                          />
                        ))}
                        {stageCompanies.length > 50 && (
                          <div className="py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                            + {stageCompanies.length - 50} more companies not shown.
                            <br/>
                            <span className="text-[10px] opacity-70">Use search/filters to find them.</span>
                          </div>
                        )}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            </div>
          </React.Fragment>
        );
      })}
    </div>
      </DragDropContext>
      {isMapModalOpen && (
        <MapModal
          companies={filteredCompanies}
          onClose={() => setIsMapModalOpen(false)}
          onCompanyClick={onCompanyClick}
        />
      )}
    </div>
  );
});
