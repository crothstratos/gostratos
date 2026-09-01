import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Company, Stage, STAGES } from '../types';
import { cn, formatLocation, getFundColorClass } from '../utils';
import { Download, FileText, FileSpreadsheet, MapPin, Globe, MessageSquare, Sparkles, MoreHorizontal, ChevronDown, Check } from 'lucide-react';



import { MapModal } from './MapModal';
import { useGemini } from '../hooks/useGemini';

interface KanbanBoardProps {
  companies: Company[];
  onMoveCompany: (companyId: string, newStage: Stage) => void;
  onCompanyClick: (company: Company) => void;
  onSaveCompany?: (company: Company) => Promise<void> | void;
}

// Relative recency, e.g. "4d" / "3mo". Tabular so the column of them lines up.
const relativeAge = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
};

const CardBody = React.memo(function CardBody({
  company,
  onCompanyClick,
  getVerticalColor,
  onMoveCompany,
  isArchiveView,
  menuOpen,
  setMenuFor,
  dragging,
}: {
  company: Company;
  onCompanyClick: (company: Company) => void;
  getVerticalColor: (vertical: string) => string;
  onMoveCompany: (companyId: string, newStage: Stage) => void;
  isArchiveView: boolean;
  menuOpen: boolean;
  setMenuFor: (id: string | null) => void;
  dragging?: boolean;
}) {
  const lastInteraction = company.interactions && company.interactions.length > 0 ? company.interactions[0] : null;

  const move = (e: React.MouseEvent, stage: Stage) => {
    e.stopPropagation();
    setMenuFor(null);
    onMoveCompany(company.id, stage);
  };

  return (
    <div
      onClick={() => onCompanyClick(company)}
      className={cn(
        "group/card relative flex cursor-pointer flex-col rounded-[10px] border bg-white p-3 shadow-sm transition-all duration-150",
        "border-slate-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-lg",
        "dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
        dragging ? "rotate-1 scale-[1.02] shadow-xl ring-2 ring-indigo-500/30" : ""
      )}
    >
      <div className="flex items-center gap-2">
        <h4 className="truncate text-[13.5px] font-semibold tracking-tight text-slate-900 dark:text-white">
          {company.name}
        </h4>
        <button
          type="button"
          aria-label={`Actions for ${company.name}`}
          onClick={(e) => { e.stopPropagation(); setMenuFor(menuOpen ? null : company.id); }}
          className={cn(
            "ml-auto shrink-0 rounded-md p-1 text-slate-400 transition",
            "hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300",
            "focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500",
            menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {(company.website || company.location) && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-slate-400 dark:text-slate-500">
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="truncate hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
              title={company.website}
            >
              {company.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          {company.website && company.location && <span className="opacity-50">·</span>}
          {company.location && <span className="truncate">{formatLocation(company.location)}</span>}
        </div>
      )}

      <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
        {company.slogan || company.basics || 'No description provided'}
      </p>

      {lastInteraction && (
        <p className="mt-1.5 line-clamp-1 text-[11.5px] italic text-slate-400 dark:text-slate-500">
          {lastInteraction.notes || lastInteraction.type}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800/60">
        {company.vertical && (
          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", getVerticalColor(company.vertical))}>
            {company.vertical}
          </span>
        )}
        {company.fund && !(company.funds && company.funds.length > 0) && (
          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", getFundColorClass(company.fund))}>
            {company.fund}
          </span>
        )}
        {company.funds && company.funds.map(f => (
          <span key={f} className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", getFundColorClass(f))}>
            {f}
          </span>
        ))}
        {lastInteraction && (
          <span className="ml-auto font-mono text-[10.5px] tabular-nums text-slate-400 dark:text-slate-500" title={`Last interaction ${new Date(lastInteraction.date).toLocaleDateString()}`}>
            {relativeAge(lastInteraction.date)}
          </span>
        )}
      </div>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-9 z-30 w-48 rounded-[10px] border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(null); onCompanyClick(company); }}
            className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Open
          </button>
          <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
          {isArchiveView ? (
            <button type="button" onClick={(e) => move(e, 'Initial Review')}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
              Restore to Initial Review
            </button>
          ) : (
            <>
              <button type="button" onClick={(e) => move(e, 'Watchlist')}
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
                Move to Watchlist
              </button>
              <button type="button" onClick={(e) => move(e, 'Passed')}
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Mark as Passed
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

const CompanyCard = React.memo(function CompanyCard(props: {
  company: Company;
  index: number;
  onCompanyClick: (company: Company) => void;
  getVerticalColor: (vertical: string) => string;
  onMoveCompany: (companyId: string, newStage: Stage) => void;
  menuOpen: boolean;
  setMenuFor: (id: string | null) => void;
}) {
  return (
    <Draggable
      // @ts-ignore - React 19 types issue with hello-pangea/dnd
      key={props.company.id}
      draggableId={props.company.id}
      index={props.index}
    >
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
          <CardBody {...props} isArchiveView={false} dragging={snapshot.isDragging} />
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

  // The board used to render all seven stages as fixed 320px columns, which ran
  // ~2,400px wide and pushed Watchlist and Passed off the right edge behind a
  // horizontal scrollbar. Only the five active pipeline stages are columns now;
  // the two archive stages are views you switch to.
  const [boardView, setBoardView] = useState<'pipeline' | 'Watchlist' | 'Passed'>('pipeline');
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [cardMenuFor, setCardMenuFor] = useState<string | null>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isViewMenuOpen && !cardMenuFor) return;
    const onDown = (e: MouseEvent) => {
      if (viewMenuRef.current && viewMenuRef.current.contains(e.target as Node)) return;
      setIsViewMenuOpen(false);
      setCardMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsViewMenuOpen(false); setCardMenuFor(null); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isViewMenuOpen, cardMenuFor]);

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

  const PIPELINE_STAGES: Stage[] = ['Initial Review', 'Analyst Call', 'Partner Call', 'DD', 'Portfolio Company'];

  const viewCounts = useMemo(() => ({
    pipeline: filteredCompanies.filter(c => PIPELINE_STAGES.includes(c.stage)).length,
    Watchlist: filteredCompanies.filter(c => c.stage === 'Watchlist').length,
    Passed: filteredCompanies.filter(c => c.stage === 'Passed').length,
  }), [filteredCompanies]);

  const archiveCompanies = useMemo(
    () => boardView === 'pipeline' ? [] : filteredCompanies.filter(c => c.stage === boardView),
    [filteredCompanies, boardView]
  );

  // Deepening tint across the pipeline, so the rail reads as progression.
  const STAGE_RAIL: Record<string, string> = {
    'Initial Review': 'bg-slate-400',
    'Analyst Call': 'bg-slate-500',
    'Partner Call': 'bg-indigo-500',
    'DD': 'bg-indigo-600',
    'Portfolio Company': 'bg-indigo-800',
  };

  const chipClass = (isActive: boolean) => cn(
    "appearance-none rounded-lg border py-1.5 pl-2.5 pr-7 text-[13px] font-medium shadow-sm transition-colors cursor-pointer",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500",
    isActive
      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
  );

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
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar: view switcher, then filters. The switcher is deliberately
          heavier and separated by a divider — changing what you are looking at
          is a different action from narrowing it. */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="relative" ref={viewMenuRef}>
          <button
            type="button"
            onClick={() => setIsViewMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={isViewMenuOpen}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13.5px] font-semibold text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600"
          >
            {boardView === 'pipeline' ? 'Pipeline' : boardView}
            <span className="font-mono text-[11.5px] font-normal tabular-nums text-slate-400 dark:text-slate-500">
              {viewCounts[boardView]}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          {isViewMenuOpen && (
            <div role="menu" className="absolute left-0 top-10 z-40 w-52 rounded-[10px] border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {([['pipeline', 'Pipeline'], ['Watchlist', 'Watchlist'], ['Passed', 'Passed']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={() => { setBoardView(key as any); setIsViewMenuOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                    boardView === key
                      ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  )}
                >
                  <span className="w-3.5 shrink-0">
                    {boardView === key && <Check className="h-3.5 w-3.5" />}
                  </span>
                  {label}
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                    {viewCounts[key as keyof typeof viewCounts]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

        <button
          onClick={() => setIsMapModalOpen(true)}
          className="hidden rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-indigo-400 sm:block"
          title="View on map"
        >
          <MapPin className="h-4 w-4" />
        </button>

        <div className="relative">
          <select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} className={chipClass(fundFilter !== 'All Funds')}>
            <option value="All Funds">All Funds ({companies.length})</option>
            <option value="Arkansas">Arkansas ({companies.filter(c => c.fund === 'Arkansas' || (c.funds && c.funds.includes('Arkansas'))).length})</option>
            <option value="Stratos OF">Stratos OF ({companies.filter(c => c.fund === 'Stratos OF' || (c.funds && c.funds.includes('Stratos OF'))).length})</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="relative">
          <select value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)} className={cn(chipClass(verticalFilter !== 'All Verticals'), "max-w-[11rem] truncate")}>
            {verticals.map((vert) => (
              <option key={vert} value={vert}>{vert}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="relative">
          <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className={cn(chipClass(locationFilter !== 'All Locations'), "max-w-[12rem] truncate")}>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="ml-auto flex items-center gap-1">
          {onSaveCompany && (
            <button
              onClick={runBulkDiscover}
              disabled={isBulkDiscovering}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Discover co-investors with AI"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden lg:inline">
                {isBulkDiscovering ? `${bulkProgress.current}/${bulkProgress.total}` : 'Co-investors'}
              </span>
            </button>
          )}
          <button onClick={exportToExcel} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
            <FileSpreadsheet className="h-4 w-4" /><span className="hidden lg:inline">Excel</span>
          </button>
          <button onClick={exportToPDF} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
            <FileText className="h-4 w-4" /><span className="hidden lg:inline">PDF</span>
          </button>
        </div>
      </div>

      {boardView === 'pipeline' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid flex-1 grid-cols-1 items-start gap-3.5 overflow-y-auto pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {PIPELINE_STAGES.map((stage) => {
              const stageCompanies = filteredCompanies.filter((c) => c.stage === stage);
              return (
                <div key={stage} className="flex min-w-0 flex-col gap-2.5">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
                    <span className={cn("h-3 w-[3px] shrink-0 rounded-sm", STAGE_RAIL[stage])} />
                    <h3 className="truncate text-[12.5px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{stage}</h3>
                    <span className="ml-auto font-mono text-[11.5px] tabular-nums text-slate-400 dark:text-slate-500">
                      {stageCompanies.length}
                    </span>
                  </div>

                  <Droppable droppableId={stage}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "flex min-h-[6rem] flex-col gap-2.5 rounded-xl p-1 -mx-1 transition-colors",
                          snapshot.isDraggingOver ? "bg-indigo-50/60 dark:bg-indigo-500/5" : ""
                        )}
                      >
                        {stageCompanies.slice(0, 50).map((company, index) => (
                          <CompanyCard
                            key={company.id}
                            company={company}
                            index={index}
                            onCompanyClick={onCompanyClick}
                            getVerticalColor={getVerticalColor}
                            onMoveCompany={onMoveCompany}
                            menuOpen={cardMenuFor === company.id}
                            setMenuFor={setCardMenuFor}
                          />
                        ))}
                        {stageCompanies.length === 0 && !snapshot.isDraggingOver && (
                          <div className="rounded-[10px] border border-dashed border-slate-200 px-3 py-4 text-center text-[12px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                            Nothing here yet
                          </div>
                        )}
                        {stageCompanies.length > 50 && (
                          <div className="rounded-[10px] border border-dashed border-slate-200 px-3 py-3 text-center text-[11.5px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            + {stageCompanies.length - 50} more not shown
                            <br /><span className="text-[10px] opacity-70">Narrow the filters to find them</span>
                          </div>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="flex-1 overflow-y-auto pb-4">
          {archiveCompanies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center text-[13px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
              No companies in {boardView}.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {archiveCompanies.map((company) => (
                <CardBody
                  key={company.id}
                  company={company}
                  onCompanyClick={onCompanyClick}
                  getVerticalColor={getVerticalColor}
                  onMoveCompany={onMoveCompany}
                  isArchiveView
                  menuOpen={cardMenuFor === company.id}
                  setMenuFor={setCardMenuFor}
                />
              ))}
            </div>
          )}
        </div>
      )}


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
