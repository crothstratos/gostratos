import { initializeApp } from 'firebase/app';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

import config from '../firebase-applet-config.json';

const firebaseConfig = (config as any).default || config;

console.log('firebaseConfig:', firebaseConfig);

export const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);
// The production database id, from the committed Firebase config.
const PRODUCTION_DATABASE_ID =
  (config as any).firestoreDatabaseId || "ai-studio-e212f446-e1ec-4969-b746-7a8ec637da86";

// Set VITE_FIRESTORE_DB=staging in .env.local to run the app against the
// staging copy. Unset — which is every deployed build — means production.
export const databaseId: string =
  (import.meta as any).env?.VITE_FIRESTORE_DB || PRODUCTION_DATABASE_ID;

export const isProductionData = databaseId === PRODUCTION_DATABASE_ID;

if (!isProductionData) {
  console.warn(`Running against the "${databaseId}" database, not production.`);
}

export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
// BigQuery scope removed: nothing in the app calls BigQuery, and requesting
// an unused sensitive scope adds friction to the Google consent screen.
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
provider.addScope('https://www.googleapis.com/auth/calendar');
provider.setCustomParameters({
  prompt: 'select_account'
});
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Instead of throwing and crashing the app, we dispatch a custom event or just return gracefully.
  // throw new Error(JSON.stringify(errInfo));
}
