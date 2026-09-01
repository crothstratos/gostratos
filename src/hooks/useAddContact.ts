import { useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Contact } from '../types';

/**
 * Adds a person to the contacts directory from inside the app.
 *
 * The document id is a SHA-1 of the lower-cased name, truncated to 20 hex
 * characters — deliberately the same derivation scripts/import-contacts.cjs
 * uses. That is what stops a person added here from turning into a duplicate
 * the next time a contacts CSV is imported: both sides land on the same id, so
 * the import merges into this document instead of creating a second one.
 *
 * If that id already exists the existing contact is returned untouched. Adding
 * someone who is already in the directory should find them, not overwrite the
 * emails and location the import gave them.
 */

const normalise = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const key = (s: string) => normalise(s).toLowerCase();

/** Matches crypto.createHash('sha1')...digest('hex').slice(0, 20) in the importer. */
async function idFor(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(key(name));
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

export interface NewContact {
  name: string;
  email?: string;
  /** Who they are with — firm, fund, company. Free text. */
  affiliation?: string;
}

export function useAddContact() {
  const [isSaving, setIsSaving] = useState(false);

  /** Returns the contact, whether it was just created or already existed. */
  const addContact = async (input: NewContact): Promise<Contact | null> => {
    const name = normalise(input.name);
    if (!name) return null;

    setIsSaving(true);
    try {
      const id = await idFor(name);
      const ref = doc(db, 'contacts', id);

      const existing = await getDoc(ref);
      if (existing.exists()) {
        return { id, ...(existing.data() as Omit<Contact, 'id'>) };
      }

      const email = (input.email || '').trim().toLowerCase();
      const parts = name.split(' ');
      const contact: Omit<Contact, 'id'> = {
        name,
        nameLower: key(name),
        firstName: parts[0],
        lastName: parts.length > 1 ? parts[parts.length - 1] : undefined,
        emails: email ? [email] : [],
        affiliation: normalise(input.affiliation || '') || undefined,
        source: 'added-in-app',
        importedAt: new Date().toISOString(),
      };

      // Firestore rejects undefined, so strip the fields that were left blank.
      const clean = Object.fromEntries(
        Object.entries(contact).filter(([, v]) => v !== undefined)
      ) as Omit<Contact, 'id'>;

      await setDoc(ref, clean);
      return { id, ...clean };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'contacts');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return { addContact, isSaving };
}
