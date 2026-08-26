import React, { useState, useRef } from 'react';
import { X, Wand2, Plus, Upload } from 'lucide-react';
import { Company, STAGES, VERTICALS, TEAM_MEMBERS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { LocationInput } from './LocationInput';
import { useGemini } from '../hooks/useGemini';
import { useAttachments } from '../hooks/useAttachments';

interface AddCompanyModalProps {
  onClose: () => void;
  onAdd: (company: Company) => Promise<void>;
  companies: Company[];
}

export const AddCompanyModal = React.memo(function AddCompanyModal({ onClose, onAdd, companies }: AddCompanyModalProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [companyId] = useState(() => uuidv4());

  const {
    isGenerating,
    isGeneratingDescription,
    error,
    setError,
    handleAutoPopulate: originalHandleAutoPopulate,
    handleGenerateDescription: originalHandleGenerateDescription,
    handlePitchDeckExtract
  } = useGemini();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isUploading: isUploadingAttachment,
    handleFileUpload,
  } = useAttachments(
    companyId,
    (newAttachments) => {
      setFormData((prev) => ({ ...prev, attachments: newAttachments }));
    },
    []
  );

  const handlePitchDeckChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    handlePitchDeckExtract(file, (extractedData) => {
      setFormData((prev) => {
        const updated = { ...prev, ...extractedData };
        if (extractedData.takeaways || extractedData.nextSteps) {
          const newInteraction = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            statusUpdate: extractedData.takeaways || '',
            nextSteps: extractedData.nextSteps || '',
          };
          updated.interactions = [...(prev.interactions || []), newInteraction];
          delete updated.takeaways;
          delete updated.nextSteps;
        }
        return updated;
      });
    });
    
    // Also upload the file to attachments
    await handleFileUpload(e);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [formData, setFormData] = useState<Partial<Company>>({
    name: '',
    website: '',
    location: undefined,
    slogan: '',
    vertical: 'Other',
    source: '',
    stage: 'Initial Review',
    basics: '',
    marketProblem: '',
    companySolution: '',
    competition: '',
    pricing: '',
    gtm: '',
    revenue: '',
    dealTerms: '',
    pastFinancing: '',
    reasonForPass: '',
    statusUpdate: '',
    attachments: [],
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let parsedValue: any = value;
    if (type === 'number') {
      parsedValue = value === '' ? undefined : Number(value);
    } else if (name === 'isShortlisted') {
      parsedValue = value === 'true';
    }
    setFormData((prev) => ({ ...prev, [name]: parsedValue }));
  };

  const existingCompany = companies.find(
    (c) => c.name.toLowerCase().trim() === (formData.name || '').toLowerCase().trim()
  );

  const handleAutoPopulate = () => {
    originalHandleAutoPopulate(notes, (extractedData) => {
      setFormData((prev) => {
        const updated = { ...prev, ...extractedData };
        if (extractedData.takeaways || extractedData.nextSteps) {
          const newInteraction = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            statusUpdate: extractedData.takeaways || '',
            nextSteps: extractedData.nextSteps || '',
          };
          updated.interactions = [...(prev.interactions || []), newInteraction];
          delete updated.takeaways;
          delete updated.nextSteps;
        }
        return updated;
      });
    });
  };

  const handleGenerateDescription = () => {
    if (!formData.name || !formData.website) {
      setError('Company name and website are required to generate a description.');
      return;
    }
    originalHandleGenerateDescription(formData.name, formData.website, (description) => {
      setFormData((prev) => ({
        ...prev,
        basics: description,
      }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      setError('Company name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const now = new Date().toISOString();
    const newCompany: Company = {
      id: companyId,
      name: formData.name,
      location: formData.location,
      website: formData.website || '',
      founderName: formData.founderName || '',
      founderEmail: formData.founderEmail || '',
      slogan: formData.slogan || '',
      vertical: formData.vertical as Company['vertical'] || 'Other',
      source: formData.source || '',
      stage: formData.stage as Company['stage'] || 'Initial Review',
      basics: formData.basics || '',
      marketProblem: formData.marketProblem || '',
      companySolution: formData.companySolution || '',
      competition: formData.competition || '',
      pricing: formData.pricing || '',
      gtm: formData.gtm || '',
      revenue: formData.revenue || '',
      dealTerms: formData.dealTerms || '',
      pastFinancing: formData.pastFinancing || '',
      reasonForPass: formData.reasonForPass || '',
      statusUpdate: formData.statusUpdate || '',
      isShortlisted: formData.isShortlisted || false,
      targetCloseDate: formData.targetCloseDate || '',
      probabilityOfClose: formData.probabilityOfClose as number | undefined,
      attachments: formData.attachments || [],
      lastModified: now,
      stageHistory: [{ stage: formData.stage as Company['stage'] || 'Initial Review', date: now }],
    };

    try {
      await onAdd(newCompany);
    } catch (err: any) {
      console.error('Failed to add company:', err);
      setError(err.message || 'Failed to add company. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fields = [
    { name: 'isShortlisted', label: 'Add to Shortlist?', type: 'boolean' },
    { name: 'targetCloseDate', label: 'Target Close Date', type: 'date' },
    { name: 'probabilityOfClose', label: 'Probability of Close (%)', type: 'number' },
    { name: 'slogan', label: 'Company Slogan', type: 'text' },
    { name: 'location', label: 'Location', type: 'location' },
    { name: 'vertical', label: 'Vertical', type: 'select', options: VERTICALS },
    { name: 'source', label: 'Internal Source', type: 'select', options: TEAM_MEMBERS },
    { name: 'externalSource', label: 'External Source', type: 'text' },
    { name: 'basics', label: 'Description', type: 'textarea' },
    { name: 'marketProblem', label: 'Market Problem', type: 'textarea' },
    { name: 'companySolution', label: 'Company Solution', type: 'textarea' },
    { name: 'competition', label: 'Competition', type: 'textarea' },
    { name: 'pricing', label: 'Pricing', type: 'text' },
    { name: 'gtm', label: 'Go-To-Market (GTM)', type: 'textarea' },
    { name: 'revenue', label: 'Revenue', type: 'text' },
    { name: 'dealTerms', label: 'Deal Terms', type: 'text' },
    { name: 'pastFinancing', label: 'Past Financing Rounds', type: 'text' },
  ];

  if (formData.stage === 'Passed') {
    fields.unshift({ name: 'reasonForPass', label: 'Reason for Pass', type: 'textarea' });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 p-4 sm:p-6 backdrop-blur-sm transition-all">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 transition-colors duration-200">
        <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60 px-6 sm:px-8 py-5 bg-slate-50/50 dark:bg-slate-800/20 rounded-t-2xl">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Add New Company
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            {/* Left Column: Auto-populate */}
            <div className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/10 p-6 h-full transition-colors shadow-sm">
                <div className="mb-4 flex items-center gap-2.5 text-indigo-700 dark:text-indigo-400">
                  <Wand2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-semibold tracking-tight">Auto-Populate with AI</h3>
                </div>
                <p className="mb-5 text-sm text-indigo-600/80 dark:text-indigo-300/80 leading-relaxed">
                  Paste notes from a call, an email, or a Google Sheet row. We'll extract the details for you. Alternatively, upload a Pitch Deck to auto-fill the fields.
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Paste company notes here..."
                  className="mb-4 w-full rounded-xl border border-indigo-200/60 dark:border-indigo-500/30 bg-white/80 dark:bg-slate-900/50 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm resize-y"
                  rows={8}
                />
                
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleAutoPopulate}
                    disabled={isGenerating || !notes.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-md disabled:opacity-50"
                  >
                    {isGenerating && notes.trim() ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Extracting...
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} />
                        Auto-Populate from Notes
                      </>
                    )}
                  </button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-indigo-200 dark:border-indigo-500/30"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-indigo-50 dark:bg-slate-900 px-2 text-indigo-500 dark:text-indigo-400">OR</span>
                    </div>
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handlePitchDeckChange}
                    accept=".pdf,.pptx,.txt,.docx,.md"
                    className="hidden"
                  />
                   
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isGenerating || isUploadingAttachment}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-500/30 px-4 py-3 text-sm font-semibold text-indigo-700 dark:text-indigo-400 transition-all hover:bg-indigo-50 dark:hover:bg-slate-700 hover:shadow-md disabled:opacity-50"
                  >
                    {(isGenerating && !notes.trim()) || isUploadingAttachment ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600/30 border-t-indigo-600 dark:border-indigo-400/30 border-t-indigo-400" />
                        Processing File...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        Upload File
                      </>
                    )}
                  </button>
                  
                  {formData.attachments && formData.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Attached Documents</p>
                      {formData.attachments.map(att => (
                        <div key={att.id} className="flex items-center text-sm text-slate-600 dark:text-slate-300 gap-2 bg-white/50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                          <span className="truncate flex-1 font-medium">{att.name}</span>
                          <span className="text-xs text-slate-400 shrink-0">Attached</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {error && <p className="mt-4 text-sm font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-900/50">{error}</p>}
              </div>
            </div>

            {/* Right Column: Form */}
            <div className="lg:col-span-3">
              <form id="add-company-form" onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Company Name *</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name || ''}
                      onChange={handleChange}
                      className={`w-full rounded-lg border ${existingCompany ? 'border-amber-500/80 dark:border-amber-500/80 focus:border-amber-500 focus:ring-amber-500/20' : 'border-slate-300/80 dark:border-slate-700/80 focus:border-indigo-500 focus:ring-indigo-500/20'} bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 transition-all shadow-sm`}
                      required
                    />
                    {existingCompany && formData.name && (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        A company with this name already exists in the Pipeline.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Website</label>
                    <input
                      type="url"
                      name="website"
                      value={formData.website || ''}
                      onChange={handleChange}
                      placeholder="https://example.com"
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Founder Name</label>
                    <input
                      type="text"
                      name="founderName"
                      value={formData.founderName || ''}
                      onChange={handleChange}
                      placeholder="e.g. Jane Doe"
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Founder Email</label>
                    <input
                      type="email"
                      name="founderEmail"
                      value={formData.founderEmail || ''}
                      onChange={handleChange}
                      placeholder="jane@example.com"
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Stage</label>
                    <select
                      name="stage"
                      value={formData.stage || ''}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm appearance-none"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Funds</label>
                    <div className="flex gap-4 items-center h-[42px] px-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(formData.funds || []).includes('Arkansas') || formData.fund === 'Arkansas'}
                          onChange={(e) => {
                            const currentFunds = new Set(formData.funds || []);
                            if (formData.fund === 'Arkansas' || formData.fund === 'Stratos OF') {
                              currentFunds.add(formData.fund);
                            }
                            if (e.target.checked) currentFunds.add('Arkansas');
                            else currentFunds.delete('Arkansas');
                            setFormData(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Arkansas</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(formData.funds || []).includes('Stratos OF') || formData.fund === 'Stratos OF'}
                          onChange={(e) => {
                            const currentFunds = new Set(formData.funds || []);
                            if (formData.fund === 'Arkansas' || formData.fund === 'Stratos OF') {
                              currentFunds.add(formData.fund);
                            }
                            if (e.target.checked) currentFunds.add('Stratos OF');
                            else currentFunds.delete('Stratos OF');
                            setFormData(prev => ({ ...prev, funds: Array.from(currentFunds), fund: undefined }));
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Stratos OF</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-slate-200/60 dark:border-slate-800/60">
                  {fields.map((field) => (
                    <div key={field.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{field.label}</label>
                        {field.name === 'basics' && (
                          <button
                            type="button"
                            onClick={handleGenerateDescription}
                            disabled={isGeneratingDescription || !formData.name || !formData.website}
                            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 transition-colors bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-md"
                          >
                            {isGeneratingDescription ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600/30 border-t-indigo-600 dark:border-indigo-400/30 dark:border-t-indigo-400" />
                            ) : (
                              <Wand2 size={12} />
                            )}
                            Generate with AI
                          </button>
                        )}
                      </div>
                      {field.type === 'textarea' ? (
                        <textarea
                          name={field.name}
                          value={formData[field.name as keyof Company] as string || ''}
                          onChange={handleChange}
                          rows={2}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm resize-y"
                        />
                      ) : field.type === 'select' ? (
                        <select
                          name={field.name}
                          value={formData[field.name as keyof Company] as string || ''}
                          onChange={handleChange}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm appearance-none"
                        >
                          <option value="">Select {field.label}</option>
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : field.type === 'location' ? (
                        <LocationInput
                          value={formData[field.name as keyof Company] as any}
                          onChange={(val) => setFormData({ ...formData, [field.name]: val })}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                        />
                      ) : field.type === 'boolean' ? (
                        <select
                          name={field.name}
                          value={formData[field.name as keyof Company] ? 'true' : 'false'}
                          onChange={handleChange}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm appearance-none"
                        >
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      ) : field.type === 'date' ? (
                        <input
                          type="date"
                          name={field.name}
                          value={formData[field.name as keyof Company] as string || ''}
                          onChange={handleChange}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                        />
                      ) : field.type === 'number' ? (
                        <input
                          type="number"
                          name={field.name}
                          value={formData[field.name as keyof Company] as number || ''}
                          onChange={handleChange}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                        />
                      ) : (
                        <input
                          type="text"
                          name={field.name}
                          value={formData[field.name as keyof Company] as string || ''}
                          onChange={handleChange}
                          className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200/60 dark:border-slate-800/60 px-6 sm:px-8 py-4 sm:py-5 bg-slate-50/50 dark:bg-slate-800/20 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-company-form"
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-md disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Adding...
              </>
            ) : (
              <>
                <Plus size={16} />
                Add Company
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
