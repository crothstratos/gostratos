import React, { useState, useRef } from 'react';
import { Company, Attachment } from '../types';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { CheckCircle2, Circle, FileText, Download, ChevronDown, Upload, User, Clock, Check, X, Building2, Trash2 } from 'lucide-react';
import { cn } from '../utils';
import { useAttachments } from '../hooks/useAttachments';

type DDTab = 'Summary' | 'Product' | 'Market' | 'Financials' | 'Legal/Team' | 'Files';

const DILIGENCE_STAGES = ['Screening', 'Deep Dive', 'IC', 'Closing'];

const PILLARS = {
  Product: [
    { id: 'tech-stack', title: 'Tech Stack', required: ['Architecture Diagram', 'Open Source Dependencies', 'Security Audit'] },
    { id: 'roadmap', title: 'Roadmap', required: ['12-Month Product Roadmap', 'Historical Velocity Metrics'] },
    { id: 'demo', title: 'Product Demo', required: ['Demo Recording', 'Feature Gap Analysis'] },
  ],
  Market: [
    { id: 'competitors', title: 'Competitors', required: ['Competitive Matrix', 'Win/Loss Analysis'] },
    { id: 'tam', title: 'TAM Analysis', required: ['Bottom-up TAM Model', 'Market Growth Report'] },
    { id: 'calls', title: 'Customer Calls', required: ['3x Customer Reference Notes', 'Churn Analysis'] },
  ],
  Financials: [
    { id: 'pnl', title: 'P&L', required: ['Historical P&L (3 yrs)', '3-Year Pro Forma', 'Unit Economics Model'] },
    { id: 'burn', title: 'Burn Rate', required: ['Cash Flow Statement', 'Runway Calculation'] },
    { id: 'cap-table', title: 'Cap Table', required: ['Current Cap Table', 'Option Pool Details'] },
  ],
  'Legal/Team': [
    { id: 'founder', title: 'Founder Background', required: ['Background Checks', 'Reference Calls (Off-list)'] },
    { id: 'ip', title: 'IP', required: ['Patent Filings', 'Trademark Registrations'] },
    { id: 'compliance', title: 'Compliance', required: ['Regulatory Approvals', 'Data Privacy Policy (GDPR/CCPA)'] },
  ],
};

const RADAR_DATA = [
  { subject: 'Product', A: 85, fullMark: 100 },
  { subject: 'Market', A: 90, fullMark: 100 },
  { subject: 'Financials', A: 70, fullMark: 100 },
  { subject: 'Team', A: 95, fullMark: 100 },
  { subject: 'Legal', A: 80, fullMark: 100 },
  { subject: 'Traction', A: 75, fullMark: 100 },
];

interface ChecklistSectionProps {
  pillarName: keyof typeof PILLARS;
  completedItems: Set<string>;
  toggleChecklist: (item: string) => void;
  findings: Record<string, string>;
  handleFindingChange: (sectionId: string, value: string) => void;
}

const ChecklistSection = React.memo(function ChecklistSection({ pillarName, completedItems, toggleChecklist, findings, handleFindingChange }: ChecklistSectionProps) {
  const sections = PILLARS[pillarName];
  
  // Local state for fast typing without triggering firestore updates on every keystroke
  const [localFindings, setLocalFindings] = useState<Record<string, string>>(findings);
  
  React.useEffect(() => {
    setLocalFindings(findings);
  }, [findings]);

  const handleChange = (sectionId: string, value: string) => {
    setLocalFindings(prev => ({ ...prev, [sectionId]: value }));
  };

  const handleBlur = (sectionId: string) => {
    if (localFindings[sectionId] !== findings[sectionId]) {
      handleFindingChange(sectionId, localFindings[sectionId] || '');
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-8">
      {sections.map(section => (
        <div key={section.id} className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 transition-all duration-200">
          {/* Left Column: Checklist */}
          <div className="col-span-1 border-r border-slate-200/60 dark:border-slate-800/60 pr-6">
            <h3 className="mb-5 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{section.title}</h3>
            <div className="space-y-4">
              {section.required.map(req => {
                const itemId = `${section.id}-${req}`;
                const isChecked = completedItems.has(itemId);
                return (
                  <label key={itemId} className="flex cursor-pointer items-start gap-3 group">
                    <button
                      type="button"
                      onClick={() => toggleChecklist(itemId)}
                      className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600 transition-colors group-hover:text-indigo-500 dark:group-hover:text-indigo-400"
                    >
                      {isChecked ? (
                        <CheckCircle2 className="text-emerald-500 dark:text-emerald-400" size={20} />
                      ) : (
                        <Circle size={20} />
                      )}
                    </button>
                    <span className={cn(
                      "text-sm transition-all leading-relaxed",
                      isChecked ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-700 dark:text-slate-300 font-medium"
                    )}>
                      {req}
                    </span>
                  </label>
                );
              })}
            </div>
            <button className="mt-6 flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-blue-300 transition-colors bg-slate-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-lg">
              <Upload size={14} /> Upload Evidence
            </button>
          </div>

          {/* Right Column: Findings */}
          <div className="col-span-1 md:col-span-2 flex flex-col">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-200">Analyst Findings & Synthesis</h3>
            <textarea
              value={localFindings[section.id] || ''}
              onChange={(e) => handleChange(section.id, e.target.value)}
              onBlur={() => handleBlur(section.id)}
              placeholder={`Enter your analysis for ${section.title}...`}
              className="flex-1 min-h-[120px] w-full resize-none rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30 p-4 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
            />
          </div>
        </div>
      ))}
    </div>
  );
});

export const DueDiligence = React.memo(function DueDiligence({ companies, onUpdateCompany }: { companies: Company[], onUpdateCompany: (company: Company) => void }) {
  const ddCompanies = companies.filter(c => c.stage === 'DD');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(ddCompanies[0]?.id || '');
  const [activeTab, setActiveTab] = useState<DDTab>('Summary');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCompany = ddCompanies.find(c => c.id === selectedCompanyId);

  const handleUpdate = React.useCallback((updates: Partial<Company>) => {
    if (!selectedCompany) return;
    onUpdateCompany({ ...selectedCompany, ...updates });
  }, [selectedCompany, onUpdateCompany]);

  const {
    isUploading,
    handleFileUpload: originalHandleFileUpload,
    handleRemoveAttachment,
    handleDownloadAttachment,
    formatFileSize
  } = useAttachments(
    selectedCompany?.id,
    (newAttachments) => {
      handleUpdate({ attachments: newAttachments });
    },
    selectedCompany?.attachments || []
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await originalHandleFileUpload(e);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  React.useEffect(() => {
    if (ddCompanies.length > 0 && !ddCompanies.find(c => c.id === selectedCompanyId)) {
      setSelectedCompanyId(ddCompanies[0].id);
    }
  }, [ddCompanies, selectedCompanyId]);

  // Derive state from selected company
  const currentStage = selectedCompany?.ddCurrentStage || 'Deep Dive';
  const verdict = selectedCompany?.ddVerdict || null;
  const completedItems = new Set(selectedCompany?.ddCompletedItems || []);
  const findings = selectedCompany?.ddFindings || {};

  const toggleChecklist = (item: string) => {
    const newSet = new Set(completedItems);
    if (newSet.has(item)) {
      newSet.delete(item);
    } else {
      newSet.add(item);
    }
    handleUpdate({ ddCompletedItems: Array.from(newSet) });
  };

  const handleFindingChange = (sectionId: string, value: string) => {
    const newFindings = { ...findings, [sectionId]: value };
    handleUpdate({ ddFindings: newFindings });
  };

  const calculateProgress = () => {
    let total = 0;
    let completed = 0;
    Object.values(PILLARS).forEach(sections => {
      sections.forEach(section => {
        section.required.forEach(req => {
          total++;
          if (completedItems.has(`${section.id}-${req}`)) completed++;
        });
      });
    });
    return total === 0 ? 0 : Math.round((completed / total) * 100);
  };

  const handleExportMemo = () => {
    alert('Exporting IC Memo to PDF...');
  };

  if (!selectedCompany) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        No companies available for Due Diligence.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50/50 dark:bg-slate-950/50 transition-colors duration-200">
      {/* Persistent Deal Header */}
      <div className="shrink-0 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl px-6 sm:px-8 py-5 shadow-sm transition-all duration-200 z-10">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10">
              <Building2 size={28} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  className="appearance-none bg-transparent text-2xl font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors tracking-tight"
                >
                  {ddCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="text-slate-400 dark:text-slate-500" />
              </div>
              <div className="mt-2 flex items-center gap-5 text-sm font-medium text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5"><User size={16} className="text-slate-400 dark:text-slate-500" /> Lead: Sarah Jenkins</span>
                <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 bg-slate-50 dark:bg-indigo-900/20 px-3 py-1 rounded-full ring-1 ring-blue-600/10 dark:ring-blue-400/20">
                  <Clock size={14} /> Day 14 in Diligence
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-4">
            <button
              onClick={handleExportMemo}
              className="flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 dark:hover:bg-indigo-700 hover:shadow-md"
            >
              <Download size={16} />
              Export IC Memo
            </button>
            
            {/* Diligence Status Bar */}
            <div className="flex items-center gap-2 text-xs font-semibold">
              {DILIGENCE_STAGES.map((stage, idx) => (
                <React.Fragment key={stage}>
                  <button
                    onClick={() => handleUpdate({ ddCurrentStage: stage })}
                    className={cn(
                      "rounded-full px-4 py-1.5 transition-all",
                      currentStage === stage 
                        ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-blue-300 ring-1 ring-inset ring-blue-600/20 dark:ring-blue-500/30 shadow-sm" 
                        : DILIGENCE_STAGES.indexOf(currentStage) > idx
                          ? "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          : "text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    )}
                  >
                    {stage}
                  </button>
                  {idx < DILIGENCE_STAGES.length - 1 && (
                    <div className={cn(
                      "h-px w-6",
                      DILIGENCE_STAGES.indexOf(currentStage) > idx ? "bg-blue-300 dark:bg-blue-700" : "bg-slate-200 dark:bg-slate-700"
                    )} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The "Command Center" Tabs */}
      <div className="shrink-0 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl px-6 sm:px-8 transition-all duration-200 z-0">
        <nav className="flex space-x-8">
          {(['Summary', 'Product', 'Market', 'Financials', 'Legal/Team', 'Files'] as DDTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "border-b-2 py-4 text-sm font-semibold transition-all",
                activeTab === tab
                  ? "border-indigo-600 dark:border-blue-400 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden p-6 sm:p-8">
        {activeTab === 'Summary' && (
          <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-3">
            {/* Scorecard Radar Chart */}
            <div className="col-span-1 md:col-span-2 rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm flex flex-col transition-all duration-200 ring-1 ring-slate-900/5 dark:ring-white/5">
              <h3 className="mb-6 text-xl font-bold text-slate-900 dark:text-white tracking-tight">Scorecard Radar</h3>
              <div className="flex-1 min-h-[300px]">
                <ResponsiveContainer width="99%" height="100%" minHeight={1} minWidth={1}>
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={RADAR_DATA}>
                    <PolarGrid stroke="#e2e8f0" className="dark:stroke-slate-700" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 13, fontWeight: 600 }} className="dark:text-slate-400" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="Score" dataKey="A" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.2} className="dark:stroke-blue-400 dark:fill-blue-400" />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="col-span-1 flex flex-col gap-6">
              {/* Progress */}
              <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm transition-all duration-200 ring-1 ring-slate-900/5 dark:ring-white/5">
                <h3 className="mb-5 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Diligence Progress</h3>
                <div className="flex items-end gap-2 mb-3">
                  <span className="text-5xl font-bold text-slate-900 dark:text-white tracking-tight">{calculateProgress()}%</span>
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1.5">completed</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800/50 ring-1 ring-inset ring-slate-900/5 dark:ring-white/5">
                  <div 
                    className="h-full bg-indigo-500 dark:bg-indigo-400 transition-all duration-500"
                    style={{ width: `${calculateProgress()}%` }}
                  />
                </div>
              </div>

              {/* Deal Verdict */}
              <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm flex-1 transition-all duration-200 ring-1 ring-slate-900/5 dark:ring-white/5">
                <h3 className="mb-5 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Deal Verdict</h3>
                <div className="flex flex-col gap-3.5">
                  <button
                    onClick={() => handleUpdate({ ddVerdict: 'Proceed' })}
                    className={cn(
                      "flex items-center justify-center gap-2.5 rounded-lg border-2 py-3.5 font-bold transition-all",
                      verdict === 'Proceed' 
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 shadow-sm" 
                        : "border-slate-200 dark:border-slate-700 text-slate-400 hover:border-emerald-200 dark:hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    )}
                  >
                    <Check size={20} /> PROCEED TO IC
                  </button>
                  <button
                    onClick={() => handleUpdate({ ddVerdict: 'Pass' })}
                    className={cn(
                      "flex items-center justify-center gap-2.5 rounded-lg border-2 py-3.5 font-bold transition-all",
                      verdict === 'Pass' 
                        ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 shadow-sm" 
                        : "border-slate-200 dark:border-slate-700 text-slate-400 hover:border-red-200 dark:hover:border-red-500/50 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    )}
                  >
                    <X size={20} /> PASS
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Product' && <ChecklistSection pillarName="Product" completedItems={completedItems} toggleChecklist={toggleChecklist} findings={findings} handleFindingChange={handleFindingChange} />}
        {activeTab === 'Market' && <ChecklistSection pillarName="Market" completedItems={completedItems} toggleChecklist={toggleChecklist} findings={findings} handleFindingChange={handleFindingChange} />}
        {activeTab === 'Financials' && <ChecklistSection pillarName="Financials" completedItems={completedItems} toggleChecklist={toggleChecklist} findings={findings} handleFindingChange={handleFindingChange} />}
        {activeTab === 'Legal/Team' && <ChecklistSection pillarName="Legal/Team" completedItems={completedItems} toggleChecklist={toggleChecklist} findings={findings} handleFindingChange={handleFindingChange} />}

        {activeTab === 'Files' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Global Document Tray</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  All files uploaded across the diligence pillars are aggregated here.
                </p>
              </div>
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center gap-2.5 rounded-lg bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm ring-1 ring-inset ring-slate-300 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600 dark:border-slate-400"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={18} /> Upload Document
                    </>
                  )}
                </button>
              </div>
            </div>

            {selectedCompany?.attachments && selectedCompany.attachments.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {selectedCompany.attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-5 shadow-sm transition-all hover:shadow-md ring-1 ring-slate-900/5 dark:ring-white/5"
                  >
                    <div className="flex items-center gap-4 overflow-hidden">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-blue-600/10 dark:ring-blue-400/20">
                        <FileText size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {file.name}
                        </p>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-4">
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(file)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700 dark:hover:text-indigo-400 transition-colors"
                        title="Download"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(file.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-12 text-center transition-all duration-200">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 mb-6">
                  <FileText size={40} className="text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-slate-900 dark:text-white tracking-tight">No documents yet</h3>
                <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                  Upload files to keep track of due diligence documents for this company.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
