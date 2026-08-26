import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, provider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser, GoogleAuthProvider } from 'firebase/auth';

interface User {
  uid: string;
  name: string;
  email: string;
  picture?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  login: () => Promise<string | undefined>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // NOTE: this check exists for user experience only. It shows a clear
      // message instead of a wall of permission-denied errors. The real
      // security boundary is firestore.rules / storage.rules, which are
      // enforced by Firebase and cannot be bypassed from the browser.
      // Keep this list in sync with those files.
      const ALLOWED_DOMAIN = 'gostratos.vc';
      const EXTRA_ALLOWED: string[] = [];
      const REVOKED_EMAILS = ['dwhite@gostratos.vc', 'cjrothai@gmail.com', 'joe@highwayventures.com'];

      if (firebaseUser) {
        const email = (firebaseUser.email || '').toLowerCase();
        const isRevoked = REVOKED_EMAILS.includes(email);
        const isAllowed =
          (email.endsWith('@' + ALLOWED_DOMAIN) || EXTRA_ALLOWED.includes(email)) && !isRevoked;

        if (!isAllowed) {
          signOut(auth);
          setUser(null);
          setAccessToken(null);
          setError(
            isRevoked
              ? 'Your access to this platform has been revoked.'
              : 'This Google account is not authorized to access the Stratos VP CRM.'
          );
          setIsLoading(false);
          return;
        }
      }
      
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'User',
          email: firebaseUser.email || '',
          picture: firebaseUser.photoURL || undefined,
        });
      } else {
        setUser(null);
        setAccessToken(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      if (token) {
        setAccessToken(token);
      }
      return token;
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Failed to login");
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setAccessToken(null);
    signOut(auth).catch((error) => {
      console.error("Error signing out:", error);
    });
  }, []);

  const value = React.useMemo(() => ({
    user, isLoading, error, login, logout, accessToken, setAccessToken
  }), [user, isLoading, error, login, logout, accessToken, setAccessToken]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
