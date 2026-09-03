import { useState } from 'react';
import { apiFetch } from '../services/api';
import { CoInvestorSuggestion } from '../types';

/**
 * Which firms has this one shared a cap table with?
 *
 * Deliberately evidence-first: the server drops any suggestion that cannot
 * name a company both firms backed, so what comes back is grounded in rounds
 * rather than in a firm sounding similar. A recommendation you can check is
 * worth several you cannot.
 */
export function useFirmCoInvestors() {
  const [results, setResults] = useState<CoInvestorSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  /** How many firms the research named, and how many lacked a shared deal. */
  const [diagnostics, setDiagnostics] = useState<{ returned: number; dropped: number; companiesExamined?: string[] } | null>(null);

  /** Returns how many co-investors were found, or null if it could not run. */
  const discover = async (opts: {
    firmName: string;
    website?: string;
    portfolioCompanies?: string[];
    knownFirms?: string[];
  }): Promise<number | null> => {
    if (!opts.firmName) return null;
    setIsSearching(true);
    setError(null);
    try {
      const response = await apiFetch('/api/discover-firm-coinvestors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${response.status}`);
      }
      const data = await response.json();
      // New firms first: a name we already track is a confirmation, and a name
      // we do not is the reason to run this at all. Within each group, more
      // shared rounds first.
      const rows: CoInvestorSuggestion[] = Array.isArray(data.coInvestors) ? data.coInvestors : [];
      rows.sort((a, b) => {
        const known = Number(a.alreadyInRepository) - Number(b.alreadyInRepository);
        if (known !== 0) return known;
        return (b.sharedDeals?.length || 0) - (a.sharedDeals?.length || 0);
      });
      setResults(rows);
      setDiagnostics(data.diagnostics || null);
      setHasRun(true);
      return rows.length;
    } catch (err: any) {
      const message = err.message || 'Unknown error';
      if (/quota|429|exhausted/i.test(message)) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else if (/unregistered callers|403|API key is missing/i.test(message)) {
        setError("The server's Gemini API key is missing or invalid. Contact your administrator.");
      } else {
        setError(`Could not research co-investors: ${message}`);
      }
      return null;
    } finally {
      setIsSearching(false);
    }
  };

  return { results, discover, isSearching, error, hasRun, diagnostics };
}
