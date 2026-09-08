import { useState, useEffect, useCallback } from 'react';
import { collection, doc, addDoc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { InvestorRepositoryEntry } from '../types';
import { useAuth } from '../components/AuthContext';

export function useInvestors() {
  const [investors, setInvestors] = useState<InvestorRepositoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, 'investor_repository'),
      (snapshot) => {
        let fetched: InvestorRepositoryEntry[] = [];
        snapshot.forEach((doc) => {
          fetched.push({ ...doc.data(), id: doc.id } as InvestorRepositoryEntry);
        });
        
        const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
        const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());
        
        if (isRestrictedUser) {
          // Assuming fundDetails or similar contains Arkansas for this tab, 
          // or we can use the 'fund' field if it gets added here. 
          // Let's filter by fundDetails containing Arkansas as a mock.
          fetched = fetched.filter(inv => (inv.fundDetails || '').toLowerCase().includes('arkansas'));
        }
        
        setInvestors(fetched);
        setIsLoading(false);
      },
      (error: any) => {
        console.error("Error fetching investors:", error);
        handleFirestoreError(error, OperationType.GET, 'investor_repository');
        setError(error.message || "Failed to connect to Firestore.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleAddInvestor = useCallback(async (investorData: Partial<InvestorRepositoryEntry>) => {
    try {
      const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
      const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());

      const entryData = {
        ...investorData,
        lastModified: new Date().toISOString(),
      };
      
      if (isRestrictedUser) {
        entryData.fundDetails = entryData.fundDetails 
          ? (entryData.fundDetails.includes('Arkansas') ? entryData.fundDetails : `${entryData.fundDetails}, Arkansas`)
          : 'Arkansas';
      }
      
      const cleanEntryData = Object.fromEntries(
        Object.entries(entryData).filter(([_, v]) => v !== undefined)
      );
      
      await addDoc(collection(db, 'investor_repository'), cleanEntryData);
    } catch (err) {
      console.error("Error saving investor:", err);
      handleFirestoreError(err, OperationType.CREATE, 'investor_repository');
      throw err;
    }
  }, [user]);

  const handleUpdateInvestor = useCallback(async (id: string, investorData: Partial<InvestorRepositoryEntry>) => {
    try {
      const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
      const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());

      const entryData = {
        ...investorData,
        lastModified: new Date().toISOString(),
      };
      
      if (isRestrictedUser) {
        entryData.fundDetails = entryData.fundDetails 
          ? (entryData.fundDetails.includes('Arkansas') ? entryData.fundDetails : `${entryData.fundDetails}, Arkansas`)
          : 'Arkansas';
      }
      
      const cleanEntryData = Object.fromEntries(
        Object.entries(entryData).filter(([_, v]) => v !== undefined)
      );
      
      await updateDoc(doc(db, 'investor_repository', id), cleanEntryData);
    } catch (err) {
      console.error("Error updating investor:", err);
      handleFirestoreError(err, OperationType.UPDATE, 'investor_repository');
      throw err;
    }
  }, [user]);

  /** Same as companies: the record is written to audit before it is removed. */
  const handleDeleteInvestor = useCallback(async (id: string) => {
    try {
      const ref = doc(db, 'investor_repository', id);
      const snap = await getDoc(ref);
      const data: any = snap.exists() ? snap.data() : null;

      await setDoc(doc(collection(db, 'audit')), {
        action: 'delete',
        collectionName: 'investor_repository',
        companyId: id,
        companyName: data?.firmName || '(unknown firm)',
        changedBy: user?.email || 'unknown',
        changedAt: new Date().toISOString(),
        changedFields: ['(deleted)'],
        deletedRecord: data,
        deletedRecordTruncated: false,
      });

      await deleteDoc(ref);
    } catch (err) {
      console.error("Error deleting investor:", err);
      handleFirestoreError(err, OperationType.DELETE, 'investor_repository');
      throw err;
    }
  }, [user]);

  return {
    investors,
    isLoading,
    error,
    handleAddInvestor,
    handleUpdateInvestor,
    handleDeleteInvestor
  };
}
