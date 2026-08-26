import React, { useState, useRef, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { ref as storageRefFn, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Company, Attachment } from '../types';

export const BulkDocumentUploader: React.FC = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ total: 0, current: 0, uploaded: 0, failed: 0, skipped: 0 });
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  const addLog = (log: string) => setLogs(prev => [...prev, log]);

  const handleFolderClick = () => {
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  const handleFileClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  const processFiles = async (files: File[] | FileList) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setLogs([]);
    setProgress({ total: files.length, current: 0, uploaded: 0, failed: 0, skipped: 0 });
    addLog(`Found ${files.length} files. Loading companies...`);

    try {
      const companiesRef = collection(db, 'companies');
      const snapshot = await getDocs(companiesRef);
      const companies: Record<string, Company> = {};
      
      snapshot.forEach(docSnap => {
        const c = docSnap.data() as Company;
        const normalizedName = c.name?.trim().toLowerCase();
        if (normalizedName) {
          companies[normalizedName] = { ...c, id: docSnap.id };
        }
      });

      addLog(`Indexed ${Object.keys(companies).length} companies for matching.`);
      // storage is imported from firebase.ts

      const sortedCompanies = Object.entries(companies).sort((a, b) => b[0].length - a[0].length);

      let uploaded = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Skip hidden files or system files
        if (file.name === '.DS_Store' || file.name === 'Thumbs.db' || (file.webkitRelativePath && file.webkitRelativePath.includes('__MACOSX'))) {
            skipped++;
            continue;
        }

        // e.g. "Root/Company XYZ/pitchdeck.pdf" -> parent folder is "Company XYZ"
        // Sometimes it's just "Company XYZ/pitchdeck.pdf"
        const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
        
        const normalizedParts = pathParts.map(p => p.trim().toLowerCase());
        const fullPathLower = file.webkitRelativePath ? file.webkitRelativePath.toLowerCase() : file.name.toLowerCase();
        
        let company: Company | undefined;
        let matchedFolderName = '';
        
        // Search parts in reverse order, ignoring the file name itself (the last part)
        for (let j = normalizedParts.length - 2; j >= 0; j--) {
          const part = normalizedParts[j];
          if (companies[part]) {
            company = companies[part];
            matchedFolderName = pathParts[j];
            break;
          }
        }

        // If no exact folder match, see if the path or file name contains a company name
        if (!company) {
          for (const [name, comp] of sortedCompanies) {
            if (name.length > 2 && fullPathLower.includes(name)) {
              company = comp;
              matchedFolderName = `Matched partly: ${name}`;
              break;
            }
          }
        }

        if (!company) {
          skipped++;
          if (i % 20 === 0) {
             setLogs(prev => {
                const newLogs = [...prev, `Skipped ${file.name} - No company match found in path: ${file.webkitRelativePath || file.name}`];
                if (newLogs.length > 5) newLogs.shift();
                return newLogs;
             });
          }
        } else {
          // Check for existing attachment
          const alreadyExists = company.attachments?.some(a => a.name === file.name);
          if (alreadyExists) {
            skipped++;
            if (i % 5 === 0) {
              setLogs(prev => {
                const newLogs = [...prev, `Skipped ${file.name} - File already exists in ${company!.name}`];
                if (newLogs.length > 5) newLogs.shift();
                return newLogs;
              });
            }
          } else {
            try {
              const documentId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
              const storageRef = storageRefFn(storage, `attachments/${company.id}/${documentId}_${file.name}`);
              
              await uploadBytes(storageRef, file);
              const downloadUrl = await getDownloadURL(storageRef);

              const newAttachment: Attachment = {
                id: documentId,
                name: file.name,
                url: downloadUrl,
                type: file.type || 'application/octet-stream',
                size: file.size
              };

              await updateDoc(doc(db, 'companies', company.id), {
                attachments: arrayUnion(newAttachment)
              });
              
              // Update local state to prevent duplicates within same upload batch
              if (!company.attachments) company.attachments = [];
              company.attachments.push(newAttachment);
              
              uploaded++;
            } catch (error: any) {
              console.error(`Failed to upload ${file.name} for ${matchedFolderName}:`, error);
              failed++;
            }
          }
        }

        setProgress(p => ({...p, current: i + 1, uploaded, failed, skipped}));

        if (i % 5 === 0) {
          setLogs(prev => {
              const newLogs = [...prev, `Progress: ${i+1}/${files.length} (${file.name})`];
              if (newLogs.length > 5) newLogs.shift();
              return newLogs;
           });
          // yield to main thread to allow UI updates
          await new Promise(r => setTimeout(r, 10)); 
        }
      }

      addLog(`Upload complete. Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`);

    } catch (e: any) {
      addLog(`Error during bulk upload: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDirectorySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
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

    addLog('Scanning dropped folders...');
    setIsUploading(true);
    setIsScanning(true);
    setScanCount(0);

    const files: File[] = [];
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
                
                // Polyfill webkitRelativePath for D&D items
                if (!file.webkitRelativePath) {
                    Object.defineProperty(file, 'webkitRelativePath', {
                        value: entry.fullPath.substring(1), 
                        writable: false
                    });
                }
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
        addLog("Failed to read all dropped folders.");
    }
    
    setIsScanning(false);
    setIsUploading(false);
    
    if (files.length > 0) {
       processFiles(files);
    }
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div 
      className={`p-4 bg-slate-900 border-2 border-dashed ${isDragOver ? 'border-indigo-500 bg-slate-800' : 'border-slate-700 bg-slate-900'} rounded-lg shadow mt-4 mb-4 text-xs transition-colors`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h3 className="text-white font-bold mb-2">Bulk Document Uploader</h3>
      <p className="text-slate-400 mb-4">
        You can drag and drop multiple folders containing company documents here. The tool will match the folder name with the company name, upload the files to Firebase Storage, and attach them.
      </p>

      <div className="mb-4">
        <button 
          type="button"
          onClick={handleFolderClick}
          disabled={isUploading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded text-xs transition"
        >
          {isUploading ? 'Uploading...' : 'Select Parent Folder'}
        </button>
        <button 
          type="button"
          onClick={handleFileClick}
          disabled={isUploading}
          className="ml-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded text-xs transition"
        >
          Select Multiple Files
        </button>
        <input 
          type="file" 
          ref={folderInputRef}
          multiple 
          style={{ display: 'none' }}
          onChange={handleDirectorySelect}
          disabled={isUploading}
          {...({ webkitdirectory: "", directory: "" } as any)}
        />
        <input 
          type="file" 
          ref={fileInputRef}
          multiple 
          style={{ display: 'none' }}
          onChange={handleDirectorySelect}
          disabled={isUploading}
        />
      </div>

      {isScanning && (
        <div className="mt-6 mb-2">
           <div className="flex justify-between text-slate-300 text-xs mb-1 animate-pulse">
            <span>Scanning folders...</span>
            <span>{scanCount} files found</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full bg-indigo-500 opacity-50 w-full animate-pulse"></div>
            <div className="bg-indigo-400 h-2.5 rounded-full relative z-10 w-1/3 animate-ping"></div>
          </div>
        </div>
      )}

      {!isScanning && progress.total > 0 && (
        <div className="mt-6 mb-2">
           <div className="flex justify-between text-slate-300 text-xs mb-1">
            <span>{pct}% Complete</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2.5">
            <div className="bg-indigo-600 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
          </div>
          <div className="flex justify-between mt-2 text-slate-400 text-xs">
            <span className="text-green-400">Uploaded: {progress.uploaded}</span>
            <span className="text-indigo-400">Skipped: {progress.skipped}</span>
            <span className="text-red-400">Failed: {progress.failed}</span>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 max-h-48 overflow-y-auto bg-black p-2 rounded text-green-400 font-mono">
          {logs.map((L, i) => <div key={i}>{L}</div>)}
        </div>
      )}
    </div>
  );
};
