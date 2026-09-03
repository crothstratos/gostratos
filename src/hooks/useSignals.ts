import { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, doc, onSnapshot, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Signal } from '../types';

/**
 * Changes the scheduled jobs noticed.
 *
 * Read-mostly: nothing in the app creates a signal, and the only writes are a
 * person marking one seen or dismissed. That asymmetry is deliberate — a feed
 * people can edit stops being a record of what happened.
 */
export function useSignals(max = 200) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'signals'), orderBy('occurredAt', 'desc'), limit(max)),
      snap => {
        setSignals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        setIsLoading(false);
      },
      err => {
        handleFirestoreError(err, OperationType.LIST, 'signals');
        setIsLoading(false);
      }
    );
    return unsub;
  }, [max]);

  const setStatus = useCallback(async (id: string, status: Signal['status']) => {
    try {
      await updateDoc(doc(db, 'signals', id), { status });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'signals');
    }
  }, []);

  const unreadCount = useMemo(
    () => signals.filter(s => s.status === 'new').length,
    [signals]
  );

  return { signals, isLoading, setStatus, unreadCount };
}
