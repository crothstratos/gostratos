import { useState, useEffect, useCallback } from 'react';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CalendarEvent } from '../types';

export function useEvents(user: any, accessToken?: string | null) {
  const [firebaseEvents, setFirebaseEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, 'events'),
      (snapshot) => {
        let fetchedEvents: CalendarEvent[] = [];
        snapshot.forEach((d) => {
          fetchedEvents.push({ ...d.data(), id: d.id } as CalendarEvent);
        });

        const RESTRICTED_EMAILS = ['arkansas1@gostratos.vc', 'arkansas2@gostratos.vc', 'jcomizio@gostratos.vc', 'lpatterson@gostratos.vc'];
        const isRestrictedUser = user?.email && RESTRICTED_EMAILS.includes(user.email.toLowerCase());
        
        if (isRestrictedUser) {
          fetchedEvents = fetchedEvents.filter(event => 
            (event.title || '').toLowerCase().includes('arkansas') || 
            (event.notes || '').toLowerCase().includes('arkansas') ||
            (typeof event.location === 'string' ? event.location : event.location?.formatted_address || '').toLowerCase().includes('arkansas')
          );
        }

        setFirebaseEvents(fetchedEvents);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'events');
      }
    );

    return () => unsubscribe();
  }, [user]);

  const fetchGoogleEvents = useCallback(async () => {
    if (!accessToken || !user?.email) return;
    try {
      const timeMin = new Date();
      timeMin.setMonth(timeMin.getMonth() - 6); // Fetch events from last 6 months

      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin.toISOString()}&maxResults=250&singleEvents=true&orderBy=startTime`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (res.ok) {
        const data = await res.json();
        const gEvents: CalendarEvent[] = data.items.map((item: any) => ({
          id: `google-${item.id}`,
          title: item.summary || 'Untitled Event',
          startDate: item.start?.dateTime || item.start?.date || '',
          endDate: item.end?.dateTime || item.end?.date || '',
          status: 'Confirmed',
          location: item.location || '',
          attendees: item.attendees?.map((a: any) => a.email).join(', ') || '',
          cost: '',
          notes: item.description || '',
          calendarType: 'Personal',
          createdBy: user.email,
        }));
        setGoogleEvents(gEvents);
      }
    } catch (e) {
      console.error('Error fetching Google Calendar events:', e);
    }
  }, [accessToken, user]);

  useEffect(() => {
    fetchGoogleEvents();
    const interval = setInterval(fetchGoogleEvents, 60 * 1000); // Poll every minute
    return () => clearInterval(interval);
  }, [fetchGoogleEvents]);

  const handleAddEvent = useCallback(async (e: CalendarEvent) => {
    try {
      const cleanEvent = Object.fromEntries(
        Object.entries(e).filter(([_, v]) => v !== undefined)
      );
      await setDoc(doc(db, 'events', e.id), cleanEvent);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'events');
    }
  }, []);

  const handleUpdateEvent = useCallback(async (e: CalendarEvent) => {
    // Events pulled from Google Calendar are read-only here. This used to
    // return silently: the user edited the title, hit Save, the modal closed
    // as though it worked, and the next poll redrew the event unchanged.
    if (e.id.startsWith('google-')) {
      alert('This event comes from your Google Calendar and cannot be edited here. Change it in Google Calendar and it will update automatically.');
      return;
    }
    try {
      const cleanEvent = Object.fromEntries(
        Object.entries(e).filter(([_, v]) => v !== undefined)
      );
      await updateDoc(doc(db, 'events', e.id), cleanEvent);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'events');
    }
  }, []);

  const handleDeleteEvent = useCallback(async (id: string) => {
    // See handleUpdateEvent — this was also a silent no-op.
    if (id.startsWith('google-')) {
      alert('This event comes from your Google Calendar and cannot be deleted here. Delete it in Google Calendar and it will disappear automatically.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'events', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'events');
    }
  }, []);

  return {
    events: [...firebaseEvents, ...googleEvents],
    handleAddEvent,
    handleUpdateEvent,
    handleDeleteEvent,
    refreshEvents: fetchGoogleEvents
  };
}
