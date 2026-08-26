import React, { useState } from 'react';
import { InvestorRepositoryEntry } from '../types';
import { Plus, X, Building2, Globe, MapPin, Edit2, Check, DollarSign, Target, Briefcase, Mail, Phone, ExternalLink, Clock, Trash2, Wand2 } from 'lucide-react';
import { LocationInput } from './LocationInput';
import { cn } from '../utils';
import { useGemini } from '../hooks/useGemini';
import { useCompanies } from '../hooks/useCompanies';
import { useAuth } from './AuthContext';

interface InvestorModalProps {
  investor: InvestorRepositoryEntry | null;
  onClose: () => void;
  onSave: (investor: Partial<InvestorRepositoryEntry>) => void;
  isNew?: boolean;
  
}

export const InvestorModal = React.memo(function InvestorModal({ investor, onClose, onSave, isNew,  }: InvestorModalProps) {
  const { user } = useAuth();
  const { companies } = useCompanies(user);
  const { isScanning, handleScanWebsite: originalHandleScanWebsite } = useGemini();
  const [isEditing, setIsEditing] = useState(isNew || false);
  const [formData, setFormData] = useState<Partial<InvestorRepositoryEntry>>(investor || {});
  const [activeTab, setActiveTab] = useState<'profile' | 'portfolio' | 'people'>('profile');

  const removePortfolioCompany = (index: number) => {
    setFormData(prev => ({
      ...prev,
      portfolioCompanies: prev.portfolioCompanies?.filter((_, i) => i !== index)
    }));
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

  const handleSaveForm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.firmName || formData.firmName.trim() === '') { alert('Firm Name is required.'); return; } onSave(formData);
    if (!isNew) setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400 shadow-sm">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isNew ? 'Add Investor' : (formData.firmName || 'Unknown Investor')}
              </h2>
              {!isNew && (
                <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {formData.location && (
                    <div className="flex items-center gap-1">
                      <MapPin size={14} />
                      <span>{typeof formData.location === 'string' ? formData.location : formData.location.formatted_address}</span>
                    </div>
                  )}
                  {formData.website && (
                    <a href={formData.website.startsWith('http') ? formData.website : `https://${formData.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
                      <Globe size={14} />
                      <span className="truncate max-w-[200px]">{formData.website}</span>
                      <ExternalLink size={12} className="ml-0.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isNew && (
              <button
                onClick={() => isEditing ? handleSaveForm() : setIsEditing(true)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors shadow-sm",
                  isEditing 
                    ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500" 
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                )}
              >
                {isEditing ? <><Check size={16} /> Save Changes</> : <><Edit2 size={16} /> Edit Profile</>}
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
          {(['profile', 'portfolio', 'people'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "border-b-2 px-6 py-4 text-sm font-semibold transition-colors capitalize",
                activeTab === tab
                  ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
              )}
            >
              {tab === 'profile' ? 'Overview' : tab === 'portfolio' ? 'Portfolio Companies' : 'Team & Contacts'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-900/50 p-6">
          <form id="investor-edit-form" onSubmit={handleSaveForm} className={isEditing ? "space-y-6" : ""}>
            {activeTab === 'profile' && (
              isEditing ? (
                <div className="grid grid-cols-2 gap-6 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Firm Details</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Firm Name *</label>
                        <input
                          type="text"
                          required
                          value={formData.firmName || ''}
                          onChange={e => setFormData({ ...formData, firmName: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Is Lead</label>
                        <select
                          value={formData.isLead ? 'Yes' : 'No'}
                          onChange={e => setFormData({ ...formData, isLead: e.target.value === 'Yes' })}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        >
                          <option value="No">No</option>
                          <option value="Yes">Yes</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Location</label>
                      <LocationInput
                        value={formData.location}
                        onChange={(val) => setFormData({ ...formData, location: val })}
                        placeholder="e.g. San Francisco, CA"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Website</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={formData.website || ''}
                          onChange={e => setFormData({ ...formData, website: e.target.value })}
                          placeholder="e.g. sequoiacap.com"
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        />
                        {handleScanWebsite && (
                          <button
                            type="button"
                            onClick={handleScanWebsite}
                            disabled={!formData.website || isScanning}
                            className="flex items-center gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
                            title="Scan website for portfolio companies"
                          >
                            {isScanning ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div> : <Wand2 size={16} />}
                            Scan
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Fund Details</label>
                      <textarea
                        value={formData.fundDetails || ''}
                        onChange={e => setFormData({ ...formData, fundDetails: e.target.value })}
                        rows={2}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        placeholder="e.g. Fund IV ($500M), focused on early stage..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Investment Stage</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {['Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Growth', 'Buyout', 'Other'].map(v => {
                            const isSelected = Array.isArray(formData.investmentStage) ? formData.investmentStage.includes(v) : formData.investmentStage?.split(',').map(s=>s.trim()).filter(Boolean).includes(v);
                            return (
                              <button
                                type="button"
                                key={v}
                                onClick={() => {
                                  const current = Array.isArray(formData.investmentStage) ? formData.investmentStage : (formData.investmentStage ? formData.investmentStage.split(',').map(s=>s.trim()).filter(Boolean) : []);
                                  if (isSelected) {
                                    setFormData({ ...formData, investmentStage: current.filter(c => c !== v) });
                                  } else {
                                    setFormData({ ...formData, investmentStage: [...current, v] });
                                  }
                                }}
                                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${isSelected ? 'bg-indigo-100 border-indigo-200 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700/50 dark:text-indigo-300' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Check Size</label>
                        <input
                          type="text"
                          value={formData.checkSize || ''}
                          onChange={e => setFormData({ ...formData, checkSize: e.target.value })}
                          placeholder="e.g. $1M - $5M"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Focus Verticals</label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {['SaaS', 'Fintech', 'Healthtech', 'AI/ML', 'Consumer', 'Deeptech', 'Climate', 'Crypto', 'Marketplace', 'Other'].map(v => {
                          const isSelected = Array.isArray(formData.verticals) ? formData.verticals.includes(v) : formData.verticals?.split(',').map(s=>s.trim()).filter(Boolean).includes(v);
                          return (
                            <button
                              type="button"
                              key={v}
                              onClick={() => {
                                const current = Array.isArray(formData.verticals) ? formData.verticals : (formData.verticals ? formData.verticals.split(',').map(s=>s.trim()).filter(Boolean) : []);
                                if (isSelected) {
                                  setFormData({ ...formData, verticals: current.filter(c => c !== v) });
                                } else {
                                  setFormData({ ...formData, verticals: [...current, v] });
                                }
                              }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${isSelected ? 'bg-indigo-100 border-indigo-200 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700/50 dark:text-indigo-300' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white">Profile Notes</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            profileNotes: [{ id: Date.now().toString(), text: '', timestamp: new Date().toISOString() }, ...(prev.profileNotes || [])]
                          }));
                        }}
                        className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                      >
                        <Plus size={14} /> Add Note
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {formData.notes && (!formData.profileNotes || formData.profileNotes.length === 0) && (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                          <div className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Legacy Note</div>
                          <textarea
                            value={formData.notes || ''}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            rows={3}
                            className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white resize-none"
                          />
                        </div>
                      )}
                      {(!formData.profileNotes || formData.profileNotes.length === 0) && !formData.notes && (
                        <div className="text-sm text-slate-500 dark:text-slate-400 italic">No notes added. Click 'Add Note' to create one.</div>
                      )}
                      {formData.profileNotes?.map((note, idx) => (
                        <div key={note.id} className="relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                profileNotes: prev.profileNotes?.filter(n => n.id !== note.id)
                              }));
                            }}
                            className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <X size={14} />
                          </button>
                          <textarea
                            value={note.text}
                            onChange={e => {
                              const newNotes = [...(formData.profileNotes || [])];
                              newNotes[idx] = { ...note, text: e.target.value };
                              setFormData({ ...formData, profileNotes: newNotes });
                            }}
                            rows={2}
                            placeholder="Type your note here..."
                            className="w-full bg-transparent border-none p-0 text-sm focus:ring-0 dark:text-white placeholder:text-slate-400 resize-none outline-none"
                          />
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <Clock size={12} />
                            {new Date(note.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 animate-in fade-in">
                  <div className="grid grid-cols-3 gap-6">
                    <div className="col-span-2 space-y-8">
                      <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                          <DollarSign size={16} className="text-emerald-500" />
                          Fund Details
                        </h3>
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed text-sm">
                          {formData.fundDetails || 'No fund details provided.'}
                        </p>
                      </section>
                      <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                          <Target size={16} className="text-indigo-500" />
                          Profile Notes
                        </h3>
                        {formData.notes && (!formData.profileNotes || formData.profileNotes.length === 0) && (
                          <div className="mb-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {formData.notes}
                          </div>
                        )}
                        {formData.profileNotes && formData.profileNotes.length > 0 ? (
                           <div className="space-y-4">
                             {formData.profileNotes.map((note) => (
                               <div key={note.id} className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4 border border-slate-100 dark:border-slate-700/50">
                                 <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap mb-2">{note.text}</p>
                                 <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                   <Clock size={12} />
                                   {new Date(note.timestamp).toLocaleString()}
                                 </div>
                               </div>
                             ))}
                           </div>
                        ) : (
                          !formData.notes && <p className="text-sm text-slate-500 dark:text-slate-400 italic">No notes added.</p>
                        )}
                      </section>
                    </div>

                    <div className="col-span-1 space-y-6">
                      <section className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4">
                          Investment Criteria
                        </h3>
                        <div className="space-y-6">
                          <div>
                            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Check Size</span>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 font-medium text-sm">
                              {formData.checkSize || 'Not specified'}
                            </div>
                          </div>
                          <div>
                            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Target Stages</span>
                            <div className="flex flex-wrap gap-2">
                              {Array.isArray(formData.investmentStage) && formData.investmentStage.length > 0 ? formData.investmentStage.map(s => (
                                <span key={s} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-blue-300 border border-indigo-200 dark:border-indigo-800">
                                  {s}
                                </span>
                              )) : (typeof formData.investmentStage === "string" && formData.investmentStage) ? formData.investmentStage.split(',').map(s => (
                                <span key={s} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-blue-300 border border-indigo-200 dark:border-indigo-800">
                                  {s.trim()}
                                </span>
                              )) : <span className="text-sm text-slate-500 italic">Not specified</span>}
                            </div>
                          </div>
                          <div>
                            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Focus Verticals</span>
                            <div className="flex flex-wrap gap-2">
                              {Array.isArray(formData.verticals) && formData.verticals.length > 0 ? formData.verticals.map(v => (
                                <span key={v} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {v}
                                </span>
                              )) : (typeof formData.verticals === "string" && formData.verticals) ? formData.verticals.split(',').map(v => (
                                <span key={v} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {v.trim()}
                                </span>
                              )) : <span className="text-sm text-slate-500 italic">Not specified</span>}
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              )
            )}

            {activeTab === 'portfolio' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-slate-900 dark:text-white">Portfolio Companies</h3>
                  {isEditing && handleScanWebsite && (
                    <button
                      type="button"
                      onClick={handleScanWebsite}
                      disabled={!formData.website || isScanning}
                      className="flex items-center gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
                      title={formData.website ? "Auto-populate portfolio from website using AI" : "Please enter a website first"}
                    >
                      {isScanning ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div> : <Wand2 size={16} />}
                      Auto-Populate
                    </button>
                  )}
                </div>
                {isEditing && !formData.website && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    Please enter a website URL in the Profile tab to use the Auto-Populate feature.
                  </p>
                )}
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                  {isEditing ? (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Companies</label>
                      <div className="mb-3 flex flex-wrap gap-2">
                        {formData.portfolioCompanies?.map((company, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm">
                            {company}
                            <button
                              type="button"
                              onClick={() => removePortfolioCompany(idx)}
                              className="text-slate-400 hover:text-red-500 ml-1"
                            >
                              <X size={14} />
                            </button>
                          </span>
                        ))}
                        {(!formData.portfolioCompanies || formData.portfolioCompanies.length === 0) && (
                          <span className="text-sm text-slate-500 dark:text-slate-400 italic">No companies added yet.</span>
                        )}
                      </div>
                      <input
                        type="text"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val) {
                              setFormData(prev => ({ ...prev, portfolioCompanies: [...(prev.portfolioCompanies || []), val] }));
                              e.currentTarget.value = '';
                            }
                          }
                        }}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                        placeholder="Type company name and press Enter"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {formData.portfolioCompanies && formData.portfolioCompanies.length > 0 ? formData.portfolioCompanies.map((company, idx) => {
                        const inCRM = companies.find(c => c.name.toLowerCase() === company.toLowerCase() || company.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(company.toLowerCase()));
                        return (
                        <div key={idx} className={cn(
                          "inline-flex items-center gap-2 px-4 py-2 rounded-xl border shadow-sm transition-shadow cursor-default",
                          inCRM ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800" : "bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 hover:shadow-md"
                        )}>
                          <Briefcase size={14} className={inCRM ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"} />
                          <span className={cn("font-medium text-sm", inCRM ? "text-indigo-900 dark:text-indigo-200" : "text-slate-700 dark:text-slate-300")}>{company}</span>
                          {inCRM && <span className="ml-1 text-[10px] uppercase font-bold text-indigo-500 bg-indigo-100 dark:bg-indigo-900/50 px-1.5 py-0.5 rounded">In CRM</span>}
                        </div>
                      )}) : <span className="text-sm text-slate-500 italic">No portfolio companies listed.</span>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'people' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-slate-900 dark:text-white">Team & Contacts</h3>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        const newContacts = [...(formData.contacts || []), { id: crypto.randomUUID(), name: '', email: '', phone: '', role: '' }];
                        setFormData({ ...formData, contacts: newContacts });
                      }}
                      className="flex items-center gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                    >
                      <Plus size={16} />
                      Add Person
                    </button>
                  )}
                </div>
                {(!formData.contacts || formData.contacts.length === 0) ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center shadow-sm">
                    <p className="text-sm text-slate-500 dark:text-slate-400">No contacts added yet.</p>
                  </div>
                ) : (
                  <div className={isEditing ? "space-y-4" : "grid grid-cols-2 gap-4"}>
                    {formData.contacts.map((contact, idx) => (
                      isEditing ? (
                        <div key={contact.id} className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-4 shadow-sm">
                          <div className="mb-4 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Person {idx + 1}</h4>
                            <button
                              type="button"
                              onClick={() => {
                                const newContacts = formData.contacts?.filter((_, i) => i !== idx);
                                setFormData({ ...formData, contacts: newContacts });
                              }}
                              className="text-slate-400 hover:text-red-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Name</label>
                              <input
                                type="text"
                                value={contact.name}
                                onChange={e => {
                                  const newContacts = [...(formData.contacts || [])];
                                  newContacts[idx] = { ...contact, name: e.target.value };
                                  setFormData({ ...formData, contacts: newContacts });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Role/Title</label>
                              <input
                                type="text"
                                value={contact.role || ''}
                                onChange={e => {
                                  const newContacts = [...(formData.contacts || [])];
                                  newContacts[idx] = { ...contact, role: e.target.value };
                                  setFormData({ ...formData, contacts: newContacts });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Email</label>
                              <input
                                type="email"
                                value={contact.email}
                                onChange={e => {
                                  const newContacts = [...(formData.contacts || [])];
                                  newContacts[idx] = { ...contact, email: e.target.value };
                                  setFormData({ ...formData, contacts: newContacts });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Phone</label>
                              <input
                                type="tel"
                                value={contact.phone}
                                onChange={e => {
                                  const newContacts = [...(formData.contacts || [])];
                                  newContacts[idx] = { ...contact, phone: e.target.value };
                                  setFormData({ ...formData, contacts: newContacts });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
                              <textarea
                                value={contact.notes || ''}
                                onChange={e => {
                                  const newContacts = [...(formData.contacts || [])];
                                  newContacts[idx] = { ...contact, notes: e.target.value };
                                  setFormData({ ...formData, contacts: newContacts });
                                }}
                                rows={2}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-white"
                                placeholder="Add notes about this person..."
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div key={contact.id} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                          <h4 className="font-semibold text-slate-900 dark:text-white text-base mb-1">{contact.name || 'Unnamed Contact'}</h4>
                          {contact.role && <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-4">{contact.role}</p>}
                          <div className="space-y-2">
                            {contact.email && (
                              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <Mail size={14} className="text-slate-400" />
                                <a href={`mailto:${contact.email}`} className="hover:text-indigo-600 transition-colors truncate">{contact.email}</a>
                              </div>
                            )}
                            {contact.phone && (
                              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <Phone size={14} className="text-slate-400" />
                                <a href={`tel:${contact.phone}`} className="hover:text-indigo-600 transition-colors">{contact.phone}</a>
                              </div>
                            )}
                          </div>
                          {contact.notes && (
                            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{contact.notes}</p>
                            </div>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
        
        {/* Footer Actions (Only in Edit Mode) */}
        {isEditing && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-6 py-4 rounded-b-2xl">
            <button
              type="button"
              onClick={() => isNew ? onClose() : setIsEditing(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveForm}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
            >
              {isNew ? 'Add Investor' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
