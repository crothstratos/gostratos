import React, { useState, useRef } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Company, Stage, STAGES, VERTICALS, TEAM_MEMBERS } from '../types';
import { read, utils } from 'xlsx';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

interface CsvUploadModalProps {
  onClose: () => void;
  onAddCompany: (company: Company) => Promise<void>;
  onUpdateCompany: (company: Company) => Promise<void>;
  existingCompanies: Company[];
}

export const CsvUploadModal: React.FC<CsvUploadModalProps> = ({
  onClose,
  onAddCompany,
  onUpdateCompany,
  existingCompanies
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const ab = evt.target?.result;
          const wb = read(ab, { type: 'array', cellDates: true });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = utils.sheet_to_json(ws);
          
          let addedCount = 0;
          let updatedCount = 0;
          
          let batch = writeBatch(db);
          let batchCount = 0;
          let commitPromises = [];

          const commitBatch = async () => {
            if (batchCount > 0) {
              commitPromises.push(batch.commit());
              batch = writeBatch(db);
              batchCount = 0;
            }
          };

          for (const row of data as any[]) {
            const name = row['Name'] || row['Company Name'] || row['name'];
            if (!name) continue;

            // Map incoming stage to standard enum
            const rawStage = String(row['Stage'] || row['stage'] || 'Passed').trim();
            const matchingStage = STAGES.find(s => s.toLowerCase() === rawStage.toLowerCase());
            const finalStage = matchingStage || 'Passed';

            const newCompanyData = {
              name: String(name).trim(),
              website: row['Website'] || row['website'] || '',
              stage: finalStage as Stage,
              basics: row['Description'] || row['Description (basics)'] || row['basics'] || '',
              vertical: (row['Vertical'] || row['vertical'] || 'Other') as any,
              source: row['Internal Source'] || row['source'] || '',
              externalSource: row['External Source'] || row['externalSource'] || '',
              marketProblem: row['Market Problem'] || '',
              companySolution: row['Company Solution'] || '',
              competition: row['Competition'] || '',
              pricing: row['Pricing'] || '',
              gtm: row['Go To Market'] || row['GTM'] || row['gtm'] || '',
              revenue: row['Revenue'] || '',
              dealTerms: row['Deal Terms'] || '',
              pastFinancing: row['Past Financing'] || '',
              founderName: row['Founder Name'] || '',
              founderEmail: row['Founder Email'] || '',
              interactions: []
            };

            // Parse Past Conversations Date if provided
            const pastContactDate = row['Past Conversation Date'] || row['Last Contact Date'] || row['Date Spoke'] || row['Date'] || row['date'];
            
            if (!pastContactDate) {
              // If there's no date, the user requested to not do anything for this row
              continue;
            }

            if (pastContactDate) {
              try {
                let parsedDate = pastContactDate;
                
                // If it's a numeric string (e.g. "45321"), convert it
                const numValue = Number(pastContactDate);
                if (!isNaN(numValue) && typeof pastContactDate === 'string' && pastContactDate.trim() !== '') {
                  if (numValue > 10000 && numValue < 100000) {
                    parsedDate = new Date((numValue - 25569) * 86400 * 1000);
                  }
                } else if (typeof pastContactDate === 'number') {
                  // Excel serial number (days since Dec 30, 1899)
                  parsedDate = new Date((pastContactDate - 25569) * 86400 * 1000);
                }
                
                const dateStr = new Date(parsedDate).toISOString();
                if (dateStr) {
                   newCompanyData.interactions = [{
                     id: crypto.randomUUID(),
                     date: dateStr,
                     type: 'Meeting',
                     notes: 'Last meeting date',
                     sentiment: 'Neutral'
                   }];
                }
              } catch (e) {
                // Ignore invalid date
              }
            }

            const existing = existingCompanies.find(c => c.name.toLowerCase() === name.toLowerCase());
            
            if (existing) {
              const updatedCompany = { ...existing };
              // Merge interactions if present
              if (newCompanyData.interactions.length > 0) {
                 updatedCompany.interactions = [...(existing.interactions || []), ...newCompanyData.interactions];
              }
              // Only override basic fields if they are empty in the existing record
              if (!updatedCompany.website && newCompanyData.website) updatedCompany.website = newCompanyData.website;
              if (!updatedCompany.basics && newCompanyData.basics) updatedCompany.basics = newCompanyData.basics;
              
              const now = new Date().toISOString();
              const finalCompany = { ...updatedCompany, lastModified: now };
              
              const cleanCompany = Object.fromEntries(
                Object.entries(finalCompany).filter(([_, v]) => v !== undefined)
              );
              
              const companyRef = doc(db, 'companies', updatedCompany.id);
              batch.update(companyRef, cleanCompany);
              batchCount++;
              updatedCount++;
              
              if (batchCount >= 400) {
                await commitBatch();
              }
            }
          }
          
          await commitBatch();
          await Promise.all(commitPromises);
          
          setSuccess(`Successfully imported company dates. Updated: ${updatedCount} companies (skipped existing unchanged and non-existing).`);
          setIsUploading(false);
          
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        } catch (err: any) {
          setError(err.message || 'Error processing spreadsheet');
          setIsUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setError(err.message || 'Failed to read file');
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden my-auto border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <FileSpreadsheet size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Import Companies</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6 prose prose-sm dark:prose-invert">
            <p className="text-slate-600 dark:text-slate-300">
              Upload a CSV or Excel file containing company data. This will create new companies or update existing ones based on matching names.
            </p>
            <h4>Supported Columns</h4>
            <ul className="text-slate-500 dark:text-slate-400 text-sm">
              <li><strong>Name</strong> (required)</li>
              <li><strong>Stage</strong> (e.g. Lead, In Progress, Passed)</li>
              <li><strong>Past Conversation Date</strong> (adds a meeting interaction log)</li>
              <li><strong>Website</strong>, <strong>Description</strong>, <strong>Vertical</strong></li>
            </ul>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="text-sm text-red-600 dark:text-red-400 font-medium">
                {error}
              </div>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                {success}
              </div>
            </div>
          )}

          <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Processing file...</p>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-slate-400 mb-4" />
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  ref={fileInputRef}
                />
                <label 
                  htmlFor="file-upload"
                  className="cursor-pointer px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-lg shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Choose File
                </label>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center">
                  Supports .csv, .xlsx, .xls formats
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
