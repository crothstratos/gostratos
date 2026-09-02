import { useState } from 'react';
import { apiFetch } from '../services/api';
import { PortfolioSuggestion, PersonSuggestion } from '../types';

/**
 * Researches a venture firm and turns the result into review-lane suggestions.
 *
 * Nothing here writes to the CRM. The caller decides what to do with what
 * comes back, and every item arrives as `pending` — a scan proposes, a person
 * disposes. That separation is the whole point: the scan is a research
 * assistant, not a source of record.
 */

export interface FirmScanResult {
  companies: PortfolioSuggestion[];
  people: PersonSuggestion[];
  location?: string;
}

export function useFirmScan() {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanFirm = async (
    opts: { url?: string; firmName?: string }
  ): Promise<FirmScanResult | null> => {
    if (!opts.url && !opts.firmName) return null;

    let url = opts.url;
    if (url && !url.startsWith('http')) url = 'https://' + url;

    setIsScanning(true);
    setError(null);
    try {
      const response = await apiFetch('/api/scan-investor-firm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, firmName: opts.firmName }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      const foundAt = new Date().toISOString();

      return {
        companies: (data.companies || []).map((c: any) => ({
          name: c.name,
          evidence: c.evidence,
          status: 'pending' as const,
          foundAt,
        })),
        people: (data.people || []).map((p: any) => ({
          name: p.name,
          role: p.role,
          linkedin: p.linkedin,
          status: 'pending' as const,
          foundAt,
        })),
        location: data.location,
      };
    } catch (err: any) {
      const message = err.message || 'Unknown error';
      // Matches the handling in useGemini: a throttled key used to look
      // identical to a firm with no results, which sent people hunting for a
      // data problem that was really a billing one.
      if (/quota|429|exhausted/i.test(message)) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else if (/unregistered callers|403|API key is missing/i.test(message)) {
        setError("The server's Gemini API key is missing or invalid. Contact your administrator.");
      } else {
        setError(`Could not research this firm: ${message}`);
      }
      return null;
    } finally {
      setIsScanning(false);
    }
  };

  return { scanFirm, isScanning, error, setError };
}
