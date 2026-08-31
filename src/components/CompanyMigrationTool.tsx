import React, { useState } from 'react';
import { collection, getDocs, setDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Company, Stage, Vertical } from '../types';

export const CompanyMigrationTool: React.FC = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ total: 0, current: 0, migrated: 0, patched: 0, failed: 0 });
  
  const addLog = (log: string) => setLogs(prev => [...prev, log]);

  const migrateCompanies = async () => {
    setIsMigrating(true);
    setLogs([]);
    setProgress({ total: 0, current: 0, migrated: 0, patched: 0, failed: 0 });
    addLog('Starting migration...');

    try {
      addLog('Fetching existing companies to resume migration...');
      const companiesRef = collection(db, 'companies');
      const companiesSnapshot = await getDocs(companiesRef);
      const existingIds = new Set(companiesSnapshot.docs.map(d => d.id));
      addLog(`Found ${existingIds.size} existing companies. Will patch these instead of overwriting.`);

      addLog('Fetching from company_data_pool...');
      const dataPoolRef = collection(db, 'company_data_pool');
      const snapshot = await getDocs(dataPoolRef);
      addLog(`Found ${snapshot.size} companies in company_data_pool.`);
      
      if (snapshot.docs.length > 0) {
        addLog(`Keys in first document: ${Object.keys(snapshot.docs[0].data()).join(', ')}`);
      }

      const totalCompanies = snapshot.size;
      setProgress(p => ({ ...p, total: totalCompanies }));

      let migratedCount = 0;
      let failedCount = 0;
      let patchedCount = 0;
      
      let index = 0;
      for (const ds of snapshot.docs) {
        index++;
        const newDocId = ds.id;
        
        const data = ds.data();
        
        let marketProblem = '';
        let companySolution = '';
        let competition = '';
        let pricing = '';
        let gtm = '';
        let revenue = '';
        let dealTerms = '';
        let pastFinancing = '';

        Object.keys(data).forEach(key => {
          const lowerKey = key.toLowerCase();
          const val = String(data[key] || '').trim();
          if (!val) return;

          if (lowerKey.includes('problem') && !marketProblem) marketProblem = val;
          if (lowerKey.includes('solution') && !lowerKey.includes('competit') && !companySolution) companySolution = val;
          if (lowerKey.includes('competit') && !competition) competition = val;
          if (lowerKey.includes('pricing') && !pricing) pricing = val;
          if ((lowerKey.includes('go-to-market') || lowerKey.includes('go to market') || lowerKey.includes('got to market') || lowerKey.includes('gtm')) && !gtm) gtm = val;
          if ((lowerKey.includes('revenue') || lowerKey.includes('arr')) && !revenue) revenue = val;
          if ((lowerKey.includes('deal term') || lowerKey.includes('terms')) && !dealTerms) dealTerms = val;
        });

        // Skip if we already migrated it, but patch the missing fields
        if (existingIds.has(newDocId)) {
          patchedCount++;
          try {
            // Only write gtm when the source actually has a value. This
            // previously wrote an empty string whenever the pool row had no
            // GTM column, so re-running the migration erased every
            // hand-written go-to-market section in the CRM.
            const sourceGtm = (gtm || String(data['Got to Market Plan'] || '')).trim();
            if (sourceGtm) {
              await updateDoc(doc(db, 'companies', newDocId), {
                gtm: sourceGtm.substring(0, 5000),
              });
            }
          } catch (e: any) {
             console.error(`Failed to update migrated fields for ${newDocId}`, e);
          }
          
          if (index % 10 === 0) {
            setProgress({ total: totalCompanies, current: index, migrated: migratedCount, patched: patchedCount, failed: failedCount });
            await new Promise(r => setTimeout(r, 10)); // release UI thread
          }
          continue;
        }

        
        // Mapping fields mapping strictly to firestore rules limits
        const newCompany = {
          id: String(newDocId).substring(0, 100),
          name: String(data['Name'] || data['Company Name'] || 'Unknown Company').substring(0, 200),
          website: String(data['Company Domain'] || '').substring(0, 500),
          founderName: String(data['Intro Call Participants (Them)'] || '').substring(0, 200),
          statusUpdate: String(data['NTV Status Note'] || '').substring(0, 5000),
          location: String(data['Location (State)'] || '').substring(0, 500),
          vertical: String(data['NTV Vertical 2'] || data['Vertical'] || 'Other').substring(0, 100),
          source: String(data['Source (internal)'] || '').substring(0, 200),
          externalSource: String(data['Source (external)'] || '').substring(0, 200),
          basics: String(data['NTV Description'] || '').substring(0, 5000),
          marketProblem: marketProblem.substring(0, 5000),
          companySolution: companySolution.substring(0, 5000),
          competition: competition.substring(0, 5000),
          pricing: pricing.substring(0, 5000),
          gtm: gtm.substring(0, 5000) || String(data['Got to Market Plan'] || '').substring(0, 5000),
          revenue: revenue.substring(0, 5000),
          dealTerms: dealTerms.substring(0, 5000),
          pastFinancing: String(data['Previously Raised'] || '').substring(0, 5000),
          stage: 'Passed',
          lastModified: new Date().toISOString()
        };

        try {
          await setDoc(doc(db, 'companies', newDocId), newCompany as any);
          migratedCount++;
        } catch (e: any) {
          console.error(`Failed to migrate ${newCompany.name}`, e);
          failedCount++;
        }

        // Release UI thread periodically and report progress
        if (index % 10 === 0) {
          setProgress({ total: totalCompanies, current: index, migrated: migratedCount, patched: patchedCount, failed: failedCount });
          setLogs(prev => {
            const newLogs = [...prev];
            if (newLogs.length > 5) newLogs.pop(); // keep log array small
            return [`Progress: ${index} / ${snapshot.size} (Migrated: ${migratedCount}, Patched: ${patchedCount})`, ...newLogs];
          });
          await new Promise(r => setTimeout(r, 10));
        }
      }

      setProgress({ total: totalCompanies, current: totalCompanies, migrated: migratedCount, patched: patchedCount, failed: failedCount });
      addLog(`Migration complete. Migrated: ${migratedCount}, Patched: ${patchedCount}, Failed: ${failedCount}`);
    } catch (e: any) {
      addLog(`Error during migration outer loop: ${e.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  // React.useEffect(() => {
  //   // Check if migration already ran
  //   if (localStorage.getItem('migration_complete')) return;
  //   migrateCompanies().then(() => {
  //     localStorage.setItem('migration_complete', 'true');
  //   });
  // }, []);

  const progressPercentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg shadow mt-4 mb-4 text-xs">
      <h3 className="text-white font-bold mb-2">DB Migration Tool</h3>
      <p className="text-slate-400 mb-4">Migrate companies from `company_data_pool` to `companies`, mapped to Passed.</p>
      <button 
        onClick={migrateCompanies}
        disabled={isMigrating}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-white disabled:opacity-50"
      >
        {isMigrating ? 'Migrating...' : 'Run Migration'}
      </button>

      {progress.total > 0 && (
        <div className="mt-6 mb-2">
          <div className="flex justify-between text-slate-300 text-xs mb-1">
            <span>{progressPercentage}% Complete</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2.5">
            <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${progressPercentage}%` }}></div>
          </div>
          <div className="flex justify-between mt-2 text-slate-400 text-xs">
            <span className="text-green-400">Migrated (New): {progress.migrated}</span>
            <span className="text-indigo-400">Patched (Existing): {progress.patched}</span>
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
