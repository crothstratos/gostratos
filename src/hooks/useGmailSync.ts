import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { Company, InteractionLog, Stage } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Logs email conversations with founders as interactions, automatically.
 *
 * Runs in the browser using the access token already held in memory from
 * sign-in, which expires in an hour and is never written down. That is the
 * whole reason it works this way: the alternative — a job running at 3am —
 * needs a stored refresh token, a permanent key to somebody's entire mailbox,
 * and holding one of those is the problem we just finished cleaning up.
 *
 * The trade is coverage. Mail only syncs while somebody has the CRM open. In
 * practice that is every working day, and each person's session reads their
 * own mailbox, so across the team every mailbox is covered — just with a lag
 * for anyone who has not signed in lately.
 */

/** Only companies live enough that a conversation matters. */
const SYNCED_STAGES = new Set<Stage>(['Initial Review', 'Analyst Call', 'Partner Call', 'DD', 'Portfolio Company']);

/** Gmail's query string has a practical length limit; addresses go in chunks. */
const ADDRESSES_PER_QUERY = 15;

/** How far back to look on a first run for a company never synced before. */
const FIRST_RUN_DAYS = 30;

/** Idle gap between sync passes while the app stays open. */
const RESYNC_MS = 30 * 60 * 1000;

/** Threads to examine per pass, across all companies. Bounds the work. */
const MAX_THREADS_PER_PASS = 25;

interface GmailMessage {
  id: string;
  threadId: string;
}

const headerOf = (payload: any, name: string): string =>
  (payload?.headers || []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

/** Pulls the address out of "Jane Doe <jane@acme.com>". */
const addressesIn = (value: string): string[] =>
  (value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(a => a.toLowerCase());

/** Recursively collects readable text from a Gmail payload. */
function bodyText(payload: any, depth = 0): string {
  if (!payload || depth > 6) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try {
      return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    } catch { return ''; }
  }
  return (payload.parts || []).map((p: any) => bodyText(p, depth + 1)).join('\n');
}

export interface GmailSyncState {
  isSyncing: boolean;
  lastRunAt: string | null;
  logged: number;
  error: string | null;
}

export function useGmailSync(
  user: any,
  accessToken: string | null,
  companies: Company[],
  onSaveCompany: (company: Company) => void | Promise<void>,
  enabled = true
): GmailSyncState & { syncNow: () => void } {
  const [state, setState] = useState<GmailSyncState>({
    isSyncing: false, lastRunAt: null, logged: 0, error: null,
  });

  // Companies change identity on every Firestore snapshot; the sync reads the
  // current list through a ref so a snapshot cannot restart it mid-pass.
  const latest = useRef(companies);
  useEffect(() => { latest.current = companies; }, [companies]);

  const running = useRef(false);

  const runSync = useCallback(async () => {
    if (running.current || !accessToken || !user?.email) return;
    running.current = true;
    setState(s => ({ ...s, isSyncing: true, error: null }));

    let logged = 0;
    try {
      const targets = latest.current.filter(
        c => c.founderEmail && c.founderEmail.includes('@') && SYNCED_STAGES.has(c.stage)
      );
      if (targets.length === 0) return;

      const byAddress = new Map<string, Company>();
      for (const c of targets) {
        for (const a of addressesIn(c.founderEmail || '')) byAddress.set(a, c);
      }

      // Oldest sync first, so a company that has not been looked at in a while
      // is not starved by ones that were checked an hour ago.
      const ordered = [...byAddress.entries()].sort(
        ([, a], [, b]) => (a.lastGmailSyncAt || '').localeCompare(b.lastGmailSyncAt || '')
      );

      const seenThreads = new Set<string>();
      const touched = new Map<string, Company>();

      for (let i = 0; i < ordered.length && seenThreads.size < MAX_THREADS_PER_PASS; i += ADDRESSES_PER_QUERY) {
        const chunk = ordered.slice(i, i + ADDRESSES_PER_QUERY);

        // One query for the whole chunk rather than one per founder: Gmail
        // charges per request, and a hundred founders is a hundred round trips.
        const clause = chunk.map(([a]) => `from:${a} OR to:${a}`).join(' OR ');
        const oldest = chunk
          .map(([, c]) => c.lastGmailSyncAt)
          .filter(Boolean)
          .sort()[0];
        const since = oldest
          ? `after:${Math.floor(new Date(oldest).getTime() / 1000)}`
          : `newer_than:${FIRST_RUN_DAYS}d`;

        const listUrl =
          `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
          `?q=${encodeURIComponent(`(${clause}) ${since}`)}&maxResults=${MAX_THREADS_PER_PASS}`;

        const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (listRes.status === 401 || listRes.status === 403) {
          // The hour is up, or the Gmail scope was never granted. Neither is an
          // error worth shouting about; the next sign-in fixes it.
          setState(s => ({ ...s, error: null }));
          return;
        }
        if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);

        const listed: GmailMessage[] = (await listRes.json()).messages || [];

        for (const msg of listed) {
          if (seenThreads.size >= MAX_THREADS_PER_PASS) break;
          if (seenThreads.has(msg.threadId)) continue;
          seenThreads.add(msg.threadId);

          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!msgRes.ok) continue;
          const full = await msgRes.json();

          const participants = new Set([
            ...addressesIn(headerOf(full.payload, 'From')),
            ...addressesIn(headerOf(full.payload, 'To')),
            ...addressesIn(headerOf(full.payload, 'Cc')),
          ]);

          // Which company this belongs to is decided here, on addresses we
          // read off the message — never inferred from the search that found it.
          let company: Company | undefined;
          for (const address of participants) {
            const match = byAddress.get(address);
            if (match) { company = touched.get(match.id) || match; break; }
          }
          if (!company) continue;

          // Already logged. The thread id is the guard, so re-running is free.
          if ((company.interactions || []).some(x => x.gmailThreadId === msg.threadId)) continue;

          const subject = headerOf(full.payload, 'Subject') || '(no subject)';
          const body = bodyText(full.payload).slice(0, 6000);
          if (body.trim().length < 40) continue;   // signatures and one-liners

          let summary = '';
          let nextSteps: string[] = [];
          try {
            const res = await apiFetch('/api/summarize-conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyName: company.name,
                emails: [{ subject, body, date: headerOf(full.payload, 'Date') }],
              }),
            });
            if (res.ok) {
              const data = await res.json();
              summary = data.summary || '';
              nextSteps = Array.isArray(data.nextSteps) ? data.nextSteps : [];
            }
          } catch { /* a thread we could not summarise is skipped, not logged blank */ }

          if (!summary && nextSteps.length === 0) continue;

          const entry: InteractionLog = {
            id: uuidv4(),
            date: new Date(Number(full.internalDate) || Date.now()).toISOString(),
            type: 'Email',
            notes: `${subject}\n\n${summary}`.trim(),
            nextSteps: nextSteps.join('\n'),
            sentiment: 'Neutral',
            source: 'gmail-auto',
            gmailThreadId: msg.threadId,
            loggedBy: user.email,
          };

          const updated: Company = {
            ...company,
            interactions: [...(company.interactions || []), entry],
            lastGmailSyncAt: new Date().toISOString(),
          };
          touched.set(company.id, updated);
          logged++;
        }
      }

      // Saved once per company at the end, not once per thread: each save is a
      // transaction with a conflict check, and three threads with one founder
      // would otherwise fight each other.
      for (const company of touched.values()) {
        await onSaveCompany(company);
      }
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message || 'Gmail sync failed.' }));
    } finally {
      running.current = false;
      setState(s => ({
        ...s,
        isSyncing: false,
        lastRunAt: new Date().toISOString(),
        logged: s.logged + logged,
      }));
    }
  }, [accessToken, user, onSaveCompany]);

  useEffect(() => {
    if (!enabled || !accessToken || !user?.email) return;
    // A short delay on load so the sync is not competing with the first paint.
    const first = setTimeout(runSync, 8000);
    const repeat = setInterval(runSync, RESYNC_MS);
    return () => { clearTimeout(first); clearInterval(repeat); };
  }, [enabled, accessToken, user, runSync]);

  return { ...state, syncNow: runSync };
}
