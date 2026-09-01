import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Company, Stage, InteractionLog } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function useCompanies(user: any) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Records the lastModified value this browser most recently wrote for each
  // company. Without it, saving twice from the same open modal would look
  // like a conflict with ourselves: the modal keeps its own copy of the
  // record and doesn't learn the new timestamp after a save.
  const ownWrites = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, 'companies'),
      async (snapshot) => {
        // NOTE: this listener used to seed the database from `initialCompanies`
        // whenever the collection came back empty. That was a prototyping
        // convenience and a live hazard: any momentary empty result would
        // write demo companies into production. Removed deliberately.
        // An empty collection now simply renders an empty pipeline.
        {
          let fetchedCompanies: Company[] = [];
          snapshot.forEach((d) => {
            const data = d.data() as Company;
            if (data.interactions) {
              data.interactions = data.interactions.map(i => {
                try {
                  const dateObj = new Date(i.date);
                  const year = dateObj.getFullYear();
                  if (year <= 1970) {
                    const ms = dateObj.getTime();
                    if (ms > 10000 && ms < 100000) {
                      const recoveredDate = new Date((ms - 25569) * 86400 * 1000);
                      return { ...i, date: recoveredDate.toISOString() };
                    }
                  }
                  return i;
                } catch(e) {
                  return i;
                }
              });
              // NOTE: this used to drop any interaction whose date failed to
              // parse. new Date('').getFullYear() returns NaN rather than
              // throwing, and NaN > 1980 is false — so the catch block that
              // was meant to keep those entries never ran, and the filtered
              // array was what got written back on the next save. Interactions
              // were being deleted permanently. Nothing is dropped now.
            }
            fetchedCompanies.push({ ...data, id: d.id });
          });
          
          const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
          const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());
          
          if (isRestrictedUser) {
            fetchedCompanies = fetchedCompanies.filter(c => c.fund === 'Arkansas' || (c.funds && c.funds.includes('Arkansas')));
          }
          
          setCompanies(fetchedCompanies);
        }
        setIsLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'companies');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Automated rule: Move companies in Initial Review for 3 weeks to Watchlist
  useEffect(() => {
    if (isLoading || companies.length === 0) return;

    const now = new Date();
    const threeWeeksInMs = 3 * 7 * 24 * 60 * 60 * 1000;
    
    const staleCompanies = companies.filter(company => {
      if (company.stage !== 'Initial Review') return false;
      
      let dateEntered = null;
      if (company.stageHistory && company.stageHistory.length > 0) {
        // Find the entry that corresponds to entering "Initial Review"
        const lastEntry = company.stageHistory[company.stageHistory.length - 1];
        if (lastEntry.stage === 'Initial Review') {
          dateEntered = new Date(lastEntry.date);
        } else {
          // Fallback to lastModified if the history is malformed for current stage
          dateEntered = company.lastModified ? new Date(company.lastModified) : null;
        }
      } else {
        // Fallback to lastModified if no stageHistory exists
        dateEntered = company.lastModified ? new Date(company.lastModified) : null;
      }

      if (dateEntered && (now.getTime() - dateEntered.getTime() > threeWeeksInMs)) {
        return true;
      }
      return false;
    });

    if (staleCompanies.length > 0) {
      staleCompanies.forEach(company => {
        const updateDateStr = new Date().toISOString();
        const newInteraction: InteractionLog = {
          id: uuidv4(),
          date: updateDateStr,
          type: 'Other',
          notes: 'No response received after 3 weeks in Initial Review.',
          sentiment: 'Neutral'
        };

        const companyRef = doc(db, 'companies', company.id);
        
        const updates = {
          stage: 'Watchlist' as Stage,
          lastModified: updateDateStr,
          stageHistory: [...(company.stageHistory || []), { stage: 'Watchlist' as Stage, date: updateDateStr }],
          interactions: [newInteraction, ...(company.interactions || [])]
        };

        updateDoc(companyRef, updates).catch(err => {
          handleFirestoreError(err, OperationType.UPDATE, 'companies');
        });
      });
    }
  }, [companies, isLoading]);

  const handleMoveCompany = useCallback(async (companyId: string, newStage: Stage) => {
    const now = new Date().toISOString();
    
    try {
      const company = companies.find(c => c.id === companyId);
      if (company && company.stage !== newStage) {
        const dateStr = new Date(now).toLocaleDateString();
        const newInteraction: InteractionLog = {
          id: uuidv4(),
          date: now,
          type: 'Other',
          notes: `Company moved to ${newStage} on ${dateStr}`,
          sentiment: 'Neutral'
        };

        const companyRef = doc(db, 'companies', companyId);
        await updateDoc(companyRef, {
          stage: newStage,
          lastModified: now,
          stageHistory: [...(company.stageHistory || []), { stage: newStage, date: now }],
          interactions: [newInteraction, ...(company.interactions || [])]
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'companies');
    }
  }, [companies]);

  const handleSaveCompany = useCallback(async (updatedCompany: Company) => {
    const now = new Date().toISOString();
    const oldCompany = companies.find(c => c.id === updatedCompany.id);
    let newHistory = updatedCompany.stageHistory || [];
    let updatedInteractions = updatedCompany.interactions || [];
    
    if (oldCompany && oldCompany.stage !== updatedCompany.stage) {
      const lastHistory = newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;
      if (!lastHistory || lastHistory.stage !== updatedCompany.stage) {
        newHistory = [...newHistory, { stage: updatedCompany.stage, date: now }];
      }
      
      const hasMoveLog = updatedInteractions.some(i => 
        i.notes?.includes(updatedCompany.stage) && 
        (i.notes?.includes('moved from') || i.notes?.includes('moved to'))
      );
      
      if (!hasMoveLog) {
        const dateStr = new Date(now).toLocaleDateString();
        const newInteraction: InteractionLog = {
          id: uuidv4(),
          date: now,
          type: 'Other',
          notes: `Company moved to ${updatedCompany.stage} on ${dateStr}`,
          sentiment: 'Neutral'
        };
        updatedInteractions = [newInteraction, ...updatedInteractions];
      }
    }
    
    const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
    const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());

    const finalCompany = { 
      ...updatedCompany, 
      lastModified: now, 
      stageHistory: newHistory,
      interactions: updatedInteractions
    };
    
    if (isRestrictedUser) {
      finalCompany.fund = 'Arkansas';
      finalCompany.funds = Array.from(new Set([...(finalCompany.funds || []), 'Arkansas']));
    }

    // Keep the flat referrer id mirror in step with the rich array. This is
    // what makes the reverse lookup possible — see Company.referrerIds.
    const referrerIds = (finalCompany.referrers || []).map(r => r.id);

    // Remove undefined values to prevent Firestore errors
    const cleanCompany = Object.fromEntries(
      Object.entries({ ...finalCompany, referrerIds, updatedBy: user?.email || 'unknown' })
        .filter(([_, v]) => v !== undefined)
    );

    // The timestamp the editor started from. If the stored record has moved
    // on since then, someone else saved while this edit was open.
    const startedFrom = updatedCompany.lastModified;

    try {
      const companyRef = doc(db, 'companies', updatedCompany.id);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(companyRef);
        if (!snap.exists()) {
          const err: any = new Error('COMPANY_DELETED');
          err.__conflict = 'deleted';
          throw err;
        }

        const stored = snap.data() as Company;
        const storedModified = stored.lastModified;
        const isOurOwnWrite = ownWrites.current.get(updatedCompany.id) === storedModified;

        if (startedFrom && storedModified && storedModified !== startedFrom && !isOurOwnWrite) {
          const err: any = new Error('EDIT_CONFLICT');
          err.__conflict = 'changed';
          err.__by = (stored as any).updatedBy || 'someone else';
          throw err;
        }

        tx.update(companyRef, cleanCompany);

        // Append-only audit record of who changed what, and when.
        const changedFields = oldCompany
          ? Object.keys(finalCompany).filter(
              k => JSON.stringify((finalCompany as any)[k]) !== JSON.stringify((oldCompany as any)[k])
            )
          : ['(new record)'];

        tx.set(doc(collection(db, 'audit')), {
          companyId: updatedCompany.id,
          companyName: updatedCompany.name || '(unnamed)',
          changedBy: user?.email || 'unknown',
          changedAt: now,
          changedFields,
        });
      });

      ownWrites.current.set(updatedCompany.id, now);
    } catch (error: any) {
      if (error?.__conflict === 'changed') {
        alert(
          `This company was changed by ${error.__by} while you had it open.\n\n` +
          `Your changes were NOT saved, so nothing of theirs was overwritten. ` +
          `Close the company, reopen it to see the current version, and reapply your edits.`
        );
        return;
      }
      if (error?.__conflict === 'deleted') {
        alert('This company was deleted by someone else while you had it open. Your changes were not saved.');
        return;
      }
      handleFirestoreError(error, OperationType.UPDATE, 'companies');
    }
  }, [companies, user]);

  const handleAddCompany = useCallback(async (newCompany: Company) => {
    try {
      const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
      const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());
      
      const companyToSave = { ...newCompany };
      if (isRestrictedUser) {
        companyToSave.fund = 'Arkansas';
        companyToSave.funds = Array.from(new Set([...(companyToSave.funds || []), 'Arkansas']));
      }

      // Remove undefined values to prevent Firestore errors
      const cleanCompany = Object.fromEntries(
        Object.entries(companyToSave).filter(([_, v]) => v !== undefined)
      );
      
      await setDoc(doc(db, 'companies', companyToSave.id), cleanCompany);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'companies');
    }
  }, [user]);

  const handleDeleteCompany = useCallback(async (companyId: string) => {
    try {
      await deleteDoc(doc(db, 'companies', companyId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'companies');
    }
  }, []);

  return {
    companies,
    isLoading,
    handleMoveCompany,
    handleSaveCompany,
    handleAddCompany,
    handleDeleteCompany
  };
}
