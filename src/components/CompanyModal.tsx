import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Upload, FileText, Trash2, Printer, Clock, ChevronDown, ChevronUp, Wand2, Download, Bell, Calendar } from 'lucide-react';
import { Company, STAGES, VERTICALS, TEAM_MEMBERS, Attachment, CalendarEvent, DealTermEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { cn, formatLocation } from '../utils';
import { useAttachments } from '../hooks/useAttachments';
import { useGemini } from '../hooks/useGemini';
import { useInvestors } from '../hooks/useInvestors';
import { useAuth } from './AuthContext';

import { CompanyConversations } from './CompanyConversations';
import { DecisionTab } from './DecisionTab';
import { LocationInput } from './LocationInput';
import { CoInvestorNetwork } from './CoInvestorNetwork';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, parseISO } from 'date-fns';

interface CompanyModalProps {
  company: Company | null;
  onClose: () => void;
  onSave: (company: Company) => void;
  onDelete?: (companyId: string) => void;
  onAddEvent?: (event: CalendarEvent) => void;
  onRefreshEvents?: () => void;
}

export const CompanyModal = React.memo(function CompanyModal({ company, onClose, onSave, onDelete, onAddEvent, onRefreshEvents }: CompanyModalProps) {
  const { user, accessToken } = useAuth();
  const { investors } = useInvestors();
  const [formData, setFormData] = useState<Company | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  // Reminder State
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderDate, setReminderDate] = useState('');

  
  const [activeVersionId, setActiveVersionId] = useState<string>('v1');

  const [activeTab, setActiveTab] = useState<'profile' | 'revenue' | 'dealTerms' | 'interactions' | 'network' | 'decision'>('profile');

  const handleVersionChange = (versionId: string) => {
    if (!formData) return;
    
    // Save current form data back to active version before switching
    const currentVersions = [...(formData.versions || [])];
    const currentIndex = currentVersions.findIndex(v => v.id === activeVersionId);
    if (currentIndex !== -1) {
      const snapshot = { ...formData };
      delete snapshot.versions;
      delete snapshot.activeVersionId;
      // See handleSubmit — append-only logs stay out of version snapshots.
      delete snapshot.interactions;
      delete snapshot.attachments;
      delete snapshot.stageHistory;
      currentVersions[currentIndex] = {
        ...currentVersions[currentIndex],
        data: snapshot
      };
    }
    
    setActiveVersionId(versionId);
    
    const targetVersion = currentVersions.find(v => v.id === versionId);
    if (targetVersion) {
      setFormData({ 
        ...formData, 
        ...targetVersion.data, 
        activeVersionId: versionId,
        versions: currentVersions
      });
    }
  };

  const handleAddInteraction = () => {
    if (!formData) return;
    const newInteraction = {
      id: uuidv4(),
      date: new Date().toISOString(),
      type: 'Call' as const,
      notes: '',
      statusUpdate: '',
      nextSteps: '',
      sentiment: 'Neutral' as const,
    };
    const updatedInteractions = [newInteraction, ...(formData.interactions || [])];
    setFormData({ ...formData, interactions: updatedInteractions });
    // Also save so it persists
    onSave({ ...formData, interactions: updatedInteractions });
  };

  const handleAddReminder = async () => {
    if (!reminderTitle || !reminderDate || !onAddEvent) return;
    
    let isPushedToGoogle = false;

    if (accessToken) {
      try {
        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            summary: reminderTitle,
            description: formData?.name ? `Reminder for ${formData.name}` : 'Reminder from CRM',
            start: {
              date: reminderDate, // format is yyyy-mm-dd
            },
            end: {
              date: reminderDate,
            }
          })
        });
        if (res.ok) {
          isPushedToGoogle = true;
          if (onRefreshEvents) {
            onRefreshEvents();
          }
        }
      } catch (err) {
        console.error('Failed to push to Google Calendar:', err);
      }
    }
    
    // Only add to local Firestore if we couldn't push to Google Calendar
    // If we successfully pushed to Google Calendar, it will be synced dynamically!
    if (!isPushedToGoogle) {
      const newEvent: CalendarEvent = {
        id: uuidv4(),
        title: reminderTitle,
        startDate: reminderDate,
        endDate: reminderDate,
        status: 'Considering',
        location: '',
        attendees: '',
        cost: '',
        notes: formData?.name ? `Reminder for ${formData.name}` : 'Reminder from CRM',
        calendarType: 'Personal',
        createdBy: user?.email,
      };
      onAddEvent(newEvent);
    }
    
    setShowReminderForm(false);
    setReminderTitle('');
    setReminderDate('');
  };

  const handleAddRevenue = () => {
    if (!formData) return;
    const newRevenueGroup = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      entries: [
        {
          id: uuidv4(),
          year: new Date().getFullYear().toString(),
          revenue: '',
          type: 'Actual' as any,
          recurringVsTransactional: '0%',
        }
      ]
    };
    const updated = [newRevenueGroup, ...(formData.revenueHistory || [])];
    setFormData({ ...formData, revenueHistory: updated });
    onSave({ ...formData, revenueHistory: updated });
  };

  const handleAddDealTerm = () => {
    if (!formData) return;
    const newTerm: DealTermEntry = {
      id: uuidv4(),
      date: new Date().toISOString(),
      raise: '',
      raiseAmount: '',
      raiseType: '',
      terms: '',
    };
    const updated = [newTerm, ...(formData.dealTermsHistory || [])];
    setFormData({ ...formData, dealTermsHistory: updated });
    onSave({ ...formData, dealTermsHistory: updated });
  };




  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isGenerating,
    isGeneratingDescription,
    error,
    setError,
    handleAutoPopulate: originalHandleAutoPopulate,
    handleGenerateDescription: originalHandleGenerateDescription,
    handlePitchDeckExtract
  } = useGemini();

  const pitchDeckInputRef = useRef<HTMLInputElement>(null);

  const {
    isUploading,
    uploadProgress,
    handleFileUpload: originalHandleFileUpload,
    uploadFiles,
    handleRemoveAttachment,
    handleDownloadAttachment,
    formatFileSize
  } = useAttachments(
    company?.id,
    (newAttachments) => {
      setFormData((prev) => prev ? { ...prev, attachments: newAttachments } : null);
    },
    formData?.attachments || []
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await originalHandleFileUpload(e);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (isUploading) return;

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    setIsScanning(true);
    setScanCount(0);

    const files: Array<File> = [];
    const queue: any[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
            if (entry) {
                queue.push(entry);
            }
        }
    }

    try {
        let count = 0;
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry) continue;

            if (entry.isFile) {
                const file = await new Promise<File>((resolve, reject) => {
                    entry.file(resolve, reject);
                });
                files.push(file);
                count++;
                if (count % 100 === 0) {
                    setScanCount(count);
                    await new Promise(r => setTimeout(r, 0)); // yield
                }
            } else if (entry.isDirectory) {
                const dirReader = entry.createReader();
                let entries: any[] = [];
                let readEntries = async () => {
                    return new Promise<any[]>((resolve, reject) => {
                        dirReader.readEntries(resolve, reject);
                    });
                };
                
                let readResult = await readEntries();
                while(readResult.length > 0) {
                    entries.push(...readResult);
                    readResult = await readEntries();
                }
                queue.push(...entries);
                // Yield periodically to keep UI responsive without artificial lag
                if (count % 200 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }
        setScanCount(count);
    } catch (err) {
        console.error("Error reading directory:", err);
    }
    
    setIsScanning(false);

    if (files.length > 0) {
       await uploadFiles(files);
    }
  };

  const handlePitchDeckChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    handlePitchDeckExtract(file, (extractedData) => {
      setFormData((prev) => {
        if (!prev) return null;
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
    handleFileUpload(e);
    
    if (pitchDeckInputRef.current) {
      pitchDeckInputRef.current.value = '';
    }
  };

  
  useEffect(() => {
    if (company) {
      setFormData(company);
      setActiveVersionId(company.activeVersionId || 'v1');
    }
  }, [company?.id]); // Only run on company ID change so we don't overwrite on every render


  if (!company || !formData) return null;

  const handleAutoPopulate = () => {
    originalHandleAutoPopulate(notes, (extractedData) => {
      setFormData((prev) => {
        if (!prev) return null;
        const updated = { ...prev, ...extractedData };
        if (extractedData.takeaways || extractedData.nextSteps) {
          const newInteraction = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            statusUpdate: extractedData.takeaways || '',
            nextSteps: extractedData.nextSteps || '',
          };
          updated.interactions = [...(prev.interactions || []), newInteraction];
          // Delete from root level so they don't pollute the rest of the object if not needed there
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
      setFormData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          basics: description,
        };
      });
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let parsedValue: any = value;
    if (type === 'number') {
      parsedValue = value === '' ? undefined : Number(value);
    } else if (name === 'isShortlisted') {
      parsedValue = value === 'true';
    }
    setFormData((prev) => prev ? { ...prev, [name]: parsedValue } : null);
  };

  
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Ensure we save the current fields into the active version
    let finalData = { ...formData };
    if (finalData.versions && finalData.versions.length > 0) {
      const versions = [...finalData.versions];
      const currentIndex = versions.findIndex(v => v.id === activeVersionId);
      if (currentIndex !== -1) {
        const snapshot = { ...finalData };
        delete snapshot.versions;
        delete snapshot.activeVersionId;
        // These are company-wide append-only logs, not per-version data.
        // Copying them into every version multiplied the document size on
        // each save and marched the record toward Firestore's 1MB ceiling.
        // handleVersionChange restores with a spread, so omitting them here
        // means the live values are preserved rather than blanked.
        delete snapshot.interactions;
        delete snapshot.attachments;
        delete snapshot.stageHistory;
        versions[currentIndex] = {
          ...versions[currentIndex],
          data: snapshot
        };
        finalData.versions = versions;
      }
    }
    finalData.activeVersionId = activeVersionId;
    
    onSave(finalData);
    onClose();
  };



  const handleDelete = () => {
    if (onDelete && formData) {
      onDelete(formData.id);
      onClose();
    }
  };

  const handleExportOnePager = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to export the one-pager.');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>${formData.name} - Investment Memo</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap');
            
            :root {
              --primary: #0f172a;
              --secondary: #475569;
              --accent: #2563eb;
              --border: #e2e8f0;
              --bg-light: #f8fafc;
            }

            * { box-sizing: border-box; }

            body { 
              font-family: 'Inter', system-ui, -apple-system, sans-serif; 
              color: var(--primary); 
              line-height: 1.6; 
              padding: 0; 
              margin: 0;
              background: #f1f5f9;
            }
            
            .page {
              max-width: 900px;
              margin: 40px auto;
              padding: 60px 60px;
              background: #fff;
              box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            }

            header {
              border-bottom: 2px solid var(--primary);
              padding-bottom: 24px;
              margin-bottom: 32px;
            }

            .memo-label {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.15em;
              color: var(--accent);
              margin-bottom: 12px;
              display: block;
            }

            .company-name {
              font-size: 42px;
              font-weight: 800;
              margin: 0 0 8px 0;
              letter-spacing: -0.02em;
              line-height: 1.1;
              color: var(--primary);
            }

            .slogan {
              font-size: 18px;
              color: var(--secondary);
              font-weight: 400;
              margin: 0 0 24px 0;
            }

            .meta-grid {
              display: grid;
              grid-template-columns: repeat(5, 1fr);
              gap: 16px;
              background: var(--bg-light);
              padding: 20px;
              border-radius: 8px;
              border: 1px solid var(--border);
            }

            .meta-item {
              display: flex;
              flex-direction: column;
            }

            .meta-label {
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: var(--secondary);
              font-weight: 700;
              margin-bottom: 4px;
            }

            .meta-value {
              font-size: 13px;
              font-weight: 600;
              color: var(--primary);
              word-break: break-word;
            }
            
            .meta-value a {
              color: var(--accent);
              text-decoration: none;
            }

            .content-grid {
              display: grid;
              grid-template-columns: 1.8fr 1fr;
              gap: 48px;
            }

            .main-column {
              display: flex;
              flex-direction: column;
              gap: 36px;
            }

            .side-column {
              display: flex;
              flex-direction: column;
              gap: 24px;
            }

            .section-title {
              font-size: 15px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: var(--primary);
              border-bottom: 1px solid var(--border);
              padding-bottom: 8px;
              margin: 0 0 16px 0;
            }

            .prose {
              font-family: 'Merriweather', serif;
              font-size: 14.5px;
              color: #334155;
              white-space: pre-wrap;
              margin: 0;
              line-height: 1.7;
            }

            .prose-sans {
              font-family: 'Inter', sans-serif;
              font-size: 13.5px;
              color: #334155;
              white-space: pre-wrap;
              margin: 0;
              line-height: 1.6;
            }

            .box {
              background: var(--bg-light);
              border: 1px solid var(--border);
              border-radius: 8px;
              padding: 20px;
            }

            .box .section-title {
              border-bottom: none;
              padding-bottom: 0;
              margin-bottom: 12px;
              font-size: 13px;
            }

            .empty-text {
              color: #94a3b8;
              font-style: italic;
            }

            @media print {
              body { background: #fff; }
              .page { padding: 0; margin: 0; max-width: 100%; box-shadow: none; }
              @page { margin: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <header>
              <span class="memo-label">Investment Memo</span>
              <h1 class="company-name">${formData.name}</h1>
              ${formData.slogan ? `<p class="slogan">${formData.slogan}</p>` : ''}
              
              <div class="meta-grid">
                <div class="meta-item">
                  <span class="meta-label">Stage</span>
                  <span class="meta-value">${formData.stage}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Vertical</span>
                  <span class="meta-value">${formData.vertical || 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Location</span>
                  <span class="meta-value">${formatLocation(formData.location) || 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Website</span>
                  <span class="meta-value">${formData.website ? `<a href="${formData.website}" target="_blank">${formData.website.replace(/^https?:\/\//, '')}</a>` : 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Founder Name</span>
                  <span class="meta-value">${formData.founderName || 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Founder Email</span>
                  <span class="meta-value">${formData.founderEmail ? `<a href="mailto:${formData.founderEmail}">${formData.founderEmail}</a>` : 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Internal Source</span>
                  <span class="meta-value">${formData.source || 'N/A'}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">External Source</span>
                  <span class="meta-value">${formData.externalSource || 'N/A'}</span>
                </div>
              </div>
            </header>

            <div class="content-grid">
              <div class="main-column">
                <section>
                  <h2 class="section-title">Company Overview</h2>
                  <p class="prose">${formData.basics || '<span class="empty-text">No overview provided.</span>'}</p>
                </section>

                ${formData.statusUpdate ? `
                <section>
                  <h2 class="section-title">Takeaways</h2>
                  <p class="prose">${formData.statusUpdate}</p>
                </section>
                ` : ''}

                <section>
                  <h2 class="section-title">Market & Problem</h2>
                  <p class="prose">${formData.marketProblem || '<span class="empty-text">No market problem provided.</span>'}</p>
                </section>

                <section>
                  <h2 class="section-title">Product & Solution</h2>
                  <p class="prose">${formData.companySolution || '<span class="empty-text">No solution provided.</span>'}</p>
                </section>

                <section>
                  <h2 class="section-title">Competitive Landscape</h2>
                  <p class="prose">${formData.competition || '<span class="empty-text">No competition data provided.</span>'}</p>
                </section>
              </div>

              <div class="side-column">
                <div class="box">
                  <h2 class="section-title">Deal Terms</h2>
                  <p class="prose-sans">${formData.dealTerms || '<span class="empty-text">N/A</span>'}</p>
                </div>

                <div class="box">
                  <h2 class="section-title">Revenue & Traction</h2>
                  <p class="prose-sans">${formData.revenue || '<span class="empty-text">N/A</span>'}</p>
                </div>

                <div class="box">
                  <h2 class="section-title">Go-To-Market & Pricing</h2>
                  <p class="prose-sans"><strong>GTM:</strong><br/>${formData.gtm || '<span class="empty-text">N/A</span>'}<br/><br/><strong>Pricing:</strong><br/>${formData.pricing || '<span class="empty-text">N/A</span>'}</p>
                </div>

                <div class="box">
                  <h2 class="section-title">Past Financing</h2>
                  <p class="prose-sans">${formData.pastFinancing || '<span class="empty-text">N/A</span>'}</p>
                </div>

                ${(formData.stage === 'Passed') ? `
                <div class="box" style="border-color: #fca5a5; background: #fef2f2;">
                  <h2 class="section-title" style="color: #991b1b;">Reason for Pass</h2>
                  <p class="prose-sans" style="color: #7f1d1d;">${formData.reasonForPass || '<span class="empty-text">N/A</span>'}</p>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
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
  ];

  if (formData.stage === 'Passed') {
    fields.unshift({ name: 'reasonForPass', label: 'Reason for Pass', type: 'textarea' });
  }

  const showAutoPopulate = formData.stage === 'Initial Review' || formData.stage === 'Analyst Call';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 p-4 sm:p-6 backdrop-blur-sm transition-all">
      <div className={cn("flex max-h-[90vh] w-full flex-col rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 transition-colors duration-200", showAutoPopulate ? "max-w-5xl" : "max-w-3xl")}>
        <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60 px-6 sm:px-8 py-5 bg-slate-50/50 dark:bg-slate-800/20 rounded-t-2xl">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {formData.name ? `${formData.name} Details` : 'Company Details'}
          </h2>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={handleExportOnePager}
              className="flex items-center gap-2 rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sm"
              title="Export One-Pager"
            >
              <Printer size={16} />
              <span className="hidden sm:inline">Export</span>
            </button>
            {onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 rounded-lg border border-red-200/60 dark:border-red-900/50 bg-red-50/80 dark:bg-red-900/20 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 transition-all hover:bg-red-100 dark:hover:bg-red-900/40 hover:shadow-sm"
                title="Delete Company"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex border-b border-slate-200/60 dark:border-slate-800/60 px-6 sm:px-8">
          <button
            onClick={() => setActiveTab('profile')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              activeTab === 'profile' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Profile
          </button>
          <button
            onClick={() => setActiveTab('revenue')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              activeTab === 'revenue' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Revenue
          </button>
          <button
            onClick={() => setActiveTab('dealTerms')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              activeTab === 'dealTerms' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Deal Terms
          </button>
          <button
            onClick={() => setActiveTab('interactions')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              activeTab === 'interactions' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Interactions
          </button>
          <button
            onClick={() => setActiveTab('decision')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5",
              activeTab === 'decision' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Decision Hub
          </button>
          <button
            onClick={() => setActiveTab('network')}
            className={cn(
              "px-4 py-3 text-sm font-semibold border-b-2 transition-colors",
              activeTab === 'network' 
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400" 
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            Network
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8">
          
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/60 dark:border-slate-800/60 pb-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <Clock size={14} className="text-slate-400" />
              <span>Last Modified: {formData.lastModified ? new Date(formData.lastModified).toLocaleDateString() : 'N/A'}</span>
            </div>
            
            {formData.versions && formData.versions.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Version:</span>
                <select
                  value={activeVersionId}
                  onChange={(e) => handleVersionChange(e.target.value)}
                  className="rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {formData.versions.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.versionName} ({new Date(v.timestamp).toLocaleDateString()} {new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>


          {formData.stageHistory && formData.stageHistory.length > 0 && (
            <div className="mb-8 overflow-hidden rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 transition-colors">
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
              >
                <span>Stage History</span>
                {showHistory ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {showHistory && (
                <div className="border-t border-slate-200/60 dark:border-slate-700/60 px-5 py-4">
                  <div className="space-y-3">
                    {formData.stageHistory.map((history, idx) => (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{history.stage}</span>
                        <DatePicker
                          selected={history.date ? parseISO(history.date) : null}
                          onChange={(date: Date | null) => {
                            const updated = [...(formData.stageHistory || [])];
                            updated[idx] = { 
                              ...updated[idx], 
                              date: date ? date.toISOString() : new Date().toISOString() 
                            };
                            setFormData({ ...formData, stageHistory: updated });
                          }}
                          className="text-slate-500 dark:text-slate-400 bg-transparent border-b border-dashed border-slate-300 dark:border-slate-600 focus:border-indigo-500 focus:ring-0 p-0 py-0.5 text-right cursor-pointer text-xs w-[85px]"
                          dateFormat="MMM d, yyyy"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              
            </div>
          )}

          <form id="company-form" onSubmit={handleSubmit} className="w-full">
          {activeTab === 'profile' && (
          <div className="flex flex-col gap-8">
            {showAutoPopulate && (
              <div className="rounded-lg border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/10 p-5 transition-colors shadow-sm">
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 text-indigo-700 dark:text-indigo-400">
                    <h3 className="font-semibold text-sm tracking-tight flex items-center gap-1.5"><Wand2 size={16} /> ✨ Auto-Populate with AI</h3>
                  </div>
                  <p className="text-xs text-indigo-600/80 dark:text-indigo-300/80">
                    Paste notes or upload a pitch deck to extract company details automatically.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-3">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Paste call notes, email text, or data snippet..."
                      className="w-full h-full min-h-[80px] rounded-lg border border-indigo-200/60 dark:border-indigo-500/30 bg-white/80 dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm resize-y"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoPopulate}
                      disabled={isGenerating || !notes.trim()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-md disabled:opacity-50"
                    >
                      {isGenerating && notes.trim() ? (
                        <>
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Extracting...
                        </>
                      ) : (
                        <>
                          <Wand2 size={14} />
                          Extract Notes
                        </>
                      )}
                    </button>
                    
                    <div className="relative my-1">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-indigo-200/60 dark:border-indigo-500/20"></div>
                      </div>
                      <div className="relative flex justify-center text-[10px]">
                        <span className="bg-indigo-50/40 dark:bg-slate-900 px-2 text-indigo-400 dark:text-indigo-500 font-medium">OR</span>
                      </div>
                    </div>

                    <input
                      type="file"
                      ref={pitchDeckInputRef}
                      onChange={handlePitchDeckChange}
                      accept=".pdf,.pptx,.txt,.docx,.md"
                      className="hidden"
                    />
                    
                    <button
                      type="button"
                      onClick={() => pitchDeckInputRef.current?.click()}
                      disabled={isGenerating || isUploading}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-500/30 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-400 transition-all hover:bg-indigo-50 dark:hover:bg-slate-700 hover:shadow-md disabled:opacity-50"
                    >
                      {(isGenerating && !notes.trim()) || isUploading ? (
                        <>
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600/30 border-t-indigo-600 dark:border-indigo-400/30 border-t-indigo-400" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Upload size={14} />
                          Upload File
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {error && <p className="mt-3 text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-md border border-red-100 dark:border-red-900/50">{error}</p>}
              </div>
            )}
            <div className="w-full">
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Company Name</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name || ''}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                      required
                    />
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

            <div className="space-y-6 pt-4">
              {fields.map((field) => (
                <div key={field.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{field.label}</label>
                    {field.name === 'basics' && showAutoPopulate && (
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
                      value={(formData[field.name as keyof Company] as string) || ''}
                      onChange={handleChange}
                      rows={3}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm resize-y"
                    />
                  ) : field.type === 'select' ? (
                    <select
                      name={field.name}
                      value={(formData[field.name as keyof Company] as string) || ''}
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
                      value={(formData[field.name as keyof Company] as string) || ''}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  ) : field.type === 'number' ? (
                    <input
                      type="number"
                      name={field.name}
                      value={(formData[field.name as keyof Company] as number) || ''}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  ) : (
                    <input
                      type="text"
                      name={field.name}
                      value={(formData[field.name as keyof Company] as string) || ''}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                    />
                  )}
                </div>
              ))}
            </div>

            {formData.founderEmail && (
              <div className="pt-8 border-t border-slate-200/60 dark:border-slate-800/60">
                <CompanyConversations 
                  founderEmail={formData.founderEmail} 
                  companyId={formData.id}
                  initialSummary={formData.conversationSummary}
                  onSyncComplete={(newSummary) => {
                    setFormData(prev => prev ? { ...prev, conversationSummary: newSummary } : prev);
                  }}
                />
              </div>
            )}

            {/* File Uploads Section */}
            <div 
              className={cn(
                "space-y-4 pt-8 pb-8 px-4 -mx-4 border-t border-slate-200/60 dark:border-slate-800/60 transition-colors",
                isDragOver ? "bg-slate-50 dark:bg-slate-800/50 outline-dashed outline-2 outline-blue-500 rounded-lg" : ""
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 tracking-tight">Files & Documents</h3>
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
                    className="flex items-center gap-2 rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sm disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600 dark:border-slate-400"></div>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        Upload Files
                      </>
                    )}
                  </button>
                </div>
              </div>

              {isDragOver && (
                <div className="pointer-events-none flex flex-col items-center justify-center p-8 text-center text-indigo-500 border-2 border-dashed border-indigo-500 rounded-lg bg-slate-50/50 dark:bg-blue-900/10">
                   <Upload className="w-8 h-8 mb-2 animate-bounce" />
                   <p className="font-medium text-sm">Drop files or folders here</p>
                </div>
              )}

              {isScanning && (
                <div className="mt-4">
                  <div className="flex justify-between text-slate-500 text-xs mb-1 animate-pulse">
                    <span>Scanning folders...</span>
                    <span>{scanCount} files found</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden relative">
                    <div className="absolute top-0 left-0 h-full bg-indigo-500 opacity-50 w-full animate-pulse"></div>
                    <div className="bg-blue-400 h-2 rounded-full relative z-10 w-1/3 animate-ping"></div>
                  </div>
                </div>
              )}

              {isUploading && !isScanning && uploadProgress.total > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-slate-500 text-xs mb-1">
                    <span>Uploading {uploadProgress.current} of {uploadProgress.total}</span>
                    <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}></div>
                  </div>
                </div>
              )}

              {formData.attachments && formData.attachments.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {formData.attachments.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                          <FileText size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          type="button"
                          onClick={() => handleDownloadAttachment(file)}
                          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(file.id)}
                          className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-8 transition-colors">
                  <FileText className="mb-2 text-slate-400 dark:text-slate-500" size={24} />
                  <p className="text-sm text-slate-500 dark:text-slate-400">No files uploaded yet.</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Upload pitch decks, term sheets, or financial models.</p>
                </div>
              )}
            </div>
          </div>
          </div>
          </div>
          )}

          {activeTab === 'revenue' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Revenue</h3>
                <button
                  type="button"
                  onClick={handleAddRevenue}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
                >
                  Add Revenue Entry
                </button>
              </div>

              {(!formData.revenueHistory || formData.revenueHistory.length === 0) ? (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No revenue data recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {formData.revenueHistory.map((revGroup, groupIdx) => {
                    const isLegacy = !revGroup.entries;
                    const entries = isLegacy 
                      ? [{ ...revGroup, id: revGroup.id || uuidv4() } as any]
                      : revGroup.entries!;

                    return (
                    <div key={revGroup.id || groupIdx} className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 p-5">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {revGroup.timestamp 
                            ? `Revenue Entry - ${new Date(revGroup.timestamp).toLocaleDateString()} ${new Date(revGroup.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : 'Revenue Entry'
                          }
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(formData.revenueHistory || [])];
                              if (isLegacy) {
                                updated[groupIdx] = {
                                  id: revGroup.id,
                                  timestamp: new Date().toISOString(),
                                  entries: [
                                    {...revGroup, id: uuidv4()} as any,
                                    { id: uuidv4(), year: new Date().getFullYear().toString(), revenue: '', type: 'Actual', recurringVsTransactional: '0%' }
                                  ]
                                };
                              } else {
                                updated[groupIdx] = {
                                  ...revGroup,
                                  entries: [
                                    ...entries,
                                    { id: uuidv4(), year: new Date().getFullYear().toString(), revenue: '', type: 'Actual', recurringVsTransactional: '0%' }
                                  ]
                                };
                              }
                              setFormData({ ...formData, revenueHistory: updated });
                            }}
                            className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium mr-3"
                          >
                            + Add Year
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(formData.revenueHistory || [])];
                              updated.splice(groupIdx, 1);
                              setFormData({ ...formData, revenueHistory: updated });
                            }}
                            className="text-red-500 hover:text-red-700 text-sm font-medium"
                          >
                            Remove Group
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {entries.map((entry, entryIdx) => (
                          <div key={entry.id || entryIdx} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1.5fr_1.5fr_auto] gap-4 items-end bg-white dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Year</label>
                              <select
                                value={entry.year || ''}
                                onChange={(e) => {
                                  const updatedGroup = [...(formData.revenueHistory || [])];
                                  const updatedEntries = [...entries];
                                  updatedEntries[entryIdx] = { ...updatedEntries[entryIdx], year: e.target.value };
                                  if (isLegacy) {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], year: e.target.value };
                                  } else {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], entries: updatedEntries };
                                  }
                                  setFormData({ ...formData, revenueHistory: updatedGroup });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                              >
                                <option value="">Select</option>
                                {[-3, -2, -1, 0, 1, 2].map((offset) => {
                                    const year = new Date().getFullYear() + offset;
                                    return <option key={year} value={year.toString()}>{year}</option>;
                                })}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Revenue</label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">$</span>
                                <input
                                  type="text"
                                  value={entry.revenue || ''}
                                  onChange={(e) => {
                                    // \D stripped the decimal point rather than
                                    // truncating at it, so 2500000.75 became
                                    // 250,000,075 and typing 1.5 gave 15.
                                    const rawValue = e.target.value.replace(/,/g, '');
                                    const cleaned = rawValue.replace(/[^\d.]/g, '');
                                    const [wholePart, ...restParts] = cleaned.split('.');
                                    const decimals = restParts.join('').slice(0, 2);
                                    const hasPoint = cleaned.includes('.');
                                    const formattedValue = cleaned
                                      ? (wholePart ? Number(wholePart).toLocaleString('en-US') : '0') +
                                        (hasPoint ? '.' + decimals : '')
                                      : '';
                                    
                                    const updatedGroup = [...(formData.revenueHistory || [])];
                                    const updatedEntries = [...entries];
                                    updatedEntries[entryIdx] = { ...updatedEntries[entryIdx], revenue: formattedValue };
                                    if (isLegacy) {
                                      updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], revenue: formattedValue };
                                    } else {
                                      updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], entries: updatedEntries };
                                    }
                                    setFormData({ ...formData, revenueHistory: updatedGroup });
                                  }}
                                  placeholder="1,000,000"
                                  className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 pl-7 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Type</label>
                              <select
                                value={entry.type || ''}
                                onChange={(e) => {
                                  const updatedGroup = [...(formData.revenueHistory || [])];
                                  const updatedEntries = [...entries];
                                  updatedEntries[entryIdx] = { ...updatedEntries[entryIdx], type: e.target.value as any };
                                  if (isLegacy) {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], type: e.target.value as any };
                                  } else {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], entries: updatedEntries };
                                  }
                                  setFormData({ ...formData, revenueHistory: updatedGroup });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                              >
                                <option value="">Select Type</option>
                                <option value="Projected">Projected</option>
                                <option value="Actual">Actual</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">% Recurring</label>
                              <select
                                value={entry.recurringVsTransactional || ''}
                                onChange={(e) => {
                                  const updatedGroup = [...(formData.revenueHistory || [])];
                                  const updatedEntries = [...entries];
                                  updatedEntries[entryIdx] = { ...updatedEntries[entryIdx], recurringVsTransactional: e.target.value };
                                  if (isLegacy) {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], recurringVsTransactional: e.target.value };
                                  } else {
                                    updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], entries: updatedEntries };
                                  }
                                  setFormData({ ...formData, revenueHistory: updatedGroup });
                                }}
                                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                              >
                                <option value="">Select %</option>
                                {[...Array(11)].map((_, i) => {
                                    const val = `${i * 10}%`;
                                    return <option key={val} value={val}>{val}</option>;
                                })}
                              </select>
                            </div>
                            {entries.length > 1 && (
                              <div className="flex items-center justify-center pb-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedGroup = [...(formData.revenueHistory || [])];
                                    const updatedEntries = [...entries];
                                    updatedEntries.splice(entryIdx, 1);
                                    if (isLegacy) {
                                       // if it's legacy and they want to delete it, maybe we just delete the group, or it shouldn't have > 1 entry
                                    } else {
                                      updatedGroup[groupIdx] = { ...updatedGroup[groupIdx], entries: updatedEntries };
                                    }
                                    setFormData({ ...formData, revenueHistory: updatedGroup });
                                  }}
                                  className="text-slate-400 hover:text-red-500 h-10 w-10 flex items-center justify-center rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
<div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="text-md font-semibold text-slate-900 dark:text-white mb-4">Overall Revenue Summary</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Current Revenue</label>
                      <textarea
                        value={formData.revenue || ''}
                        onChange={(e) => setFormData({ ...formData, revenue: e.target.value })}
                        rows={4}
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Current revenue details..."
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Past Revenue</label>
                      <textarea
                        value={formData.pastRevenue || ''}
                        onChange={(e) => setFormData({ ...formData, pastRevenue: e.target.value })}
                        rows={4}
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Past revenue details..."
                      />
                    </div>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'dealTerms' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Deal Terms</h3>
                <button
                  type="button"
                  onClick={handleAddDealTerm}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
                >
                  Add Deal
                </button>
              </div>

              {(!formData.dealTermsHistory || formData.dealTermsHistory.length === 0) ? (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No deal terms recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {formData.dealTermsHistory.map((term, idx) => (
                    <div key={term.id || idx} className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 p-5">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {new Date(term.date).toLocaleDateString()} {new Date(term.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(formData.dealTermsHistory || [])];
                              updated.splice(idx, 1);
                              setFormData({ ...formData, dealTermsHistory: updated });
                            }}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Raise</label>
                          <select
                            value={term.raise || ''}
                            onChange={(e) => {
                              const updated = [...(formData.dealTermsHistory || [])];
                              updated[idx] = { ...updated[idx], raise: e.target.value };
                              setFormData({ ...formData, dealTermsHistory: updated });
                            }}
                            className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                          >
                            <option value="">Select Raise...</option>
                            <option value="Pre-Seed">Pre-Seed</option>
                            <option value="Seed">Seed</option>
                            <option value="Seed+">Seed+</option>
                            <option value="Series A">Series A</option>
                            <option value="Series A+">Series A+</option>
                            <option value="Series B">Series B</option>
                            <option value="Series B+">Series B+</option>
                            <option value="Series C">Series C</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Raise Amount</label>
                          <input
                            type="text"
                            value={term.raiseAmount ? term.raiseAmount.toLocaleString() : ''}
                            onChange={(e) => {
                              const rawValue = e.target.value.replace(/,/g, '');
                              const numValue = rawValue === '' ? '' : Number(rawValue);
                              if (rawValue === '' || !isNaN(numValue as number)) {
                                const updated = [...(formData.dealTermsHistory || [])];
                                updated[idx] = { ...updated[idx], raiseAmount: numValue };
                                setFormData({ ...formData, dealTermsHistory: updated });
                              }
                            }}
                            className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Raise Type</label>
                          <select
                            value={term.raiseType || ''}
                            onChange={(e) => {
                              const updated = [...(formData.dealTermsHistory || [])];
                              updated[idx] = { ...updated[idx], raiseType: e.target.value };
                              setFormData({ ...formData, dealTermsHistory: updated });
                            }}
                            className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                          >
                            <option value="">Select Type...</option>
                            <option value="SAFE">SAFE</option>
                            <option value="Convertible Note">Convertible Note</option>
                            <option value="Priced Round">Priced Round</option>
                            <option value="TBD">TBD</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="mt-4 grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Notes</label>
                          <textarea
                            value={term.terms || ''}
                            onChange={(e) => {
                              const updated = [...(formData.dealTermsHistory || [])];
                              updated[idx] = { ...updated[idx], terms: e.target.value };
                              setFormData({ ...formData, dealTermsHistory: updated });
                            }}
                            rows={2}
                            className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="text-md font-semibold text-slate-900 dark:text-white mb-4">Current & Past Financing</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Current Deal Terms</label>
                      <textarea
                        value={formData.dealTerms || ''}
                        onChange={(e) => setFormData({ ...formData, dealTerms: e.target.value })}
                        rows={5}
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Current terms..."
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Past Financing Rounds</label>
                      <textarea
                        value={formData.pastFinancing || ''}
                        onChange={(e) => setFormData({ ...formData, pastFinancing: e.target.value })}
                        rows={5}
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Past financing rounds..."
                      />
                    </div>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'decision' && formData && (
            <div className="pt-2">
              <DecisionTab 
                company={formData}
                onSaveDecision={(newStage, notes, decisionDateStr) => {
                  const nowStr = decisionDateStr ? new Date(`${decisionDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();
                  const dateStr = new Date(nowStr).toLocaleDateString();
                  
                  let newInteractionNotes = notes;
                  if (newStage !== formData.stage) {
                    newInteractionNotes += `\n\n*(Company moved from ${formData.stage} to ${newStage} on ${dateStr})*`;
                  }

                  const newInteraction = {
                    id: Math.random().toString(36).substring(2, 9),
                    date: nowStr,
                    type: 'Other' as const,
                    notes: newInteractionNotes,
                    sentiment: 'Neutral' as const
                  };
                  
                  const updatedHistory = [...(formData.stageHistory || [])];
                  if (newStage !== formData.stage) {
                    updatedHistory.push({ stage: newStage, date: nowStr });
                  }
                  
                  const updatedCompany = { 
                    ...formData, 
                    stage: newStage,
                    stageHistory: updatedHistory,
                    interactions: [newInteraction, ...(formData.interactions || [])] 
                  };
                  
                  setFormData(updatedCompany);
                  onSave(updatedCompany);
                  setActiveTab('interactions');
                }}
              />
            </div>
          )}

          {activeTab === 'network' && formData && (
            <div className="pt-2">
              <CoInvestorNetwork 
                company={formData} 
                investors={investors} 
                onSave={(updatedCompany) => {
                  setFormData(updatedCompany);
                  onSave(updatedCompany); // also save to backend immediately
                }}
              />
            </div>
          )}

          {activeTab === 'interactions' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Interactions</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Stage:</label>
                    <select
                      name="stage"
                      value={formData.stage || ''}
                      onChange={handleChange}
                      className="rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm appearance-none"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!showReminderForm && (
                    <button
                      type="button"
                      onClick={() => setShowReminderForm(true)}
                      className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Bell size={16} />
                      Add Reminder
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddInteraction}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
                  >
                    Add Interaction
                  </button>
                </div>
              </div>

              {showReminderForm && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-5 space-y-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                      <Bell size={16} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Schedule Private Reminder</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">This will be synced to your personal calendar.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Title</label>
                      <input
                        type="text"
                        value={reminderTitle}
                        onChange={(e) => setReminderTitle(e.target.value)}
                        placeholder="e.g. Follow up on Q3 metrics..."
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-slate-100 dark:placeholder-slate-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Date</label>
                      <DatePicker
                        selected={reminderDate ? parseISO(reminderDate) : null}
                        onChange={(date: Date | null) => setReminderDate(date ? format(date, 'yyyy-MM-dd') : '')}
                        className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:text-slate-100"
                        wrapperClassName="w-full"
                        placeholderText="Select date..."
                        dateFormat="yyyy-MM-dd"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowReminderForm(false)}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddReminder}
                      disabled={!reminderTitle || !reminderDate}
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Calendar size={16} />
                      Save to Calendar
                    </button>
                  </div>
                </div>
              )}

              {(!formData.interactions || formData.interactions.length === 0) ? (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No interactions recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {formData.interactions.map((interaction, idx) => (
                    <div key={interaction.id || idx} className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 p-5">
                      <div className="mb-4 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={interaction.date ? interaction.date.split('T')[0] : ''}
                            onChange={(e) => {
                              const updated = [...(formData.interactions || [])];
                              updated[idx] = { 
                                ...updated[idx], 
                                date: e.target.value ? new Date(e.target.value + 'T12:00:00Z').toISOString() : new Date().toISOString()
                              };
                              setFormData({ ...formData, interactions: updated });
                            }}
                            className="rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(formData.interactions || [])];
                              updated.splice(idx, 1);
                              setFormData({ ...formData, interactions: updated });
                            }}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Takeaways</label>
                            <textarea
                              value={interaction.statusUpdate || ''}
                              onChange={(e) => {
                                const updated = [...(formData.interactions || [])];
                                updated[idx] = { ...updated[idx], statusUpdate: e.target.value };
                                setFormData({ ...formData, interactions: updated });
                              }}
                              rows={3}
                              className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Next Steps</label>
                            <textarea
                              value={interaction.nextSteps || ''}
                              onChange={(e) => {
                                const updated = [...(formData.interactions || [])];
                                updated[idx] = { ...updated[idx], nextSteps: e.target.value };
                                setFormData({ ...formData, interactions: updated });
                              }}
                              rows={3}
                              className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Legacy takeaways for existing companies */}
              {formData.statusUpdate !== undefined && (
                <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="text-md font-semibold text-slate-900 dark:text-white mb-4">Legacy Takeaways</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">This field was moved from the profile tab. Use the Interactions section above for new takeaways.</p>
                  <textarea
                    value={formData.statusUpdate || ''}
                    onChange={(e) => setFormData({ ...formData, statusUpdate: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Legacy takeaways..."
                  />
                </div>
              )}
            </div>
          )}
          </form>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="company-form"
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Save size={16} />
            Save Changes
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 p-6 shadow-2xl transition-colors duration-200">
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">Delete Company</h3>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              Are you sure you want to delete <strong>{formData.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
