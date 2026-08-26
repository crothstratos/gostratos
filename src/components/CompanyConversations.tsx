import { apiFetch } from '../services/api';
import React, { useState, useEffect } from 'react';
import { Mail, RefreshCw, AlertCircle, MessageSquare } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

interface ConversationSummary {
  summary: string;
  nextSteps: string[];
  lastSyncedAt?: string;
  lastSyncedByEmail?: string;
  emailCount?: number;
}

interface CompanyConversationsProps {
  founderEmail: string;
  companyId: string;
  initialSummary?: ConversationSummary;
  onSyncComplete?: (summary: ConversationSummary) => void;
}

export const CompanyConversations: React.FC<CompanyConversationsProps> = ({ founderEmail, companyId, initialSummary, onSyncComplete }) => {
  const { accessToken, login, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ConversationSummary | null>(initialSummary || null);
  const [emailCount, setEmailCount] = useState(initialSummary?.emailCount || 0);

  useEffect(() => {
    if (initialSummary && !data) {
      setData(initialSummary);
      setEmailCount(initialSummary.emailCount || 0);
    }
  }, [initialSummary]);

  const fetchEmailsAndSummarize = async () => {
    if (!accessToken) {
      await login();
      // It will trigger useEffect if token gets updated, but let's just wait for the user to try again if it fails
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch recent emails involving the founder
      // Using `to:` and `from:` ensures we get the conversation.
      const query = `to:${founderEmail} OR from:${founderEmail}`;
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`;
      
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication required or missing Gmail scope. Please reconnect.');
        }
        throw new Error('Failed to fetch emails from Gmail API.');
      }

      const listData = await response.json();
      
      if (!listData.messages || listData.messages.length === 0) {
        setData(null);
        setEmailCount(0);
        setIsLoading(false);
        return;
      }

      setEmailCount(listData.messages.length);

      // Fetch details of each message
      const emails = [];
      for (const msg of listData.messages) {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          const headers = msgData.payload?.headers || [];
          const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          
          let body = '';
          if (msgData.payload?.parts) {
            const textPart = msgData.payload.parts.find((p: any) => p.mimeType === 'text/plain');
            if (textPart && textPart.body?.data) {
              body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
            }
          } else if (msgData.payload?.body?.data) {
            body = atob(msgData.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
          }

          emails.push({
            date: getHeader('date'),
            from: getHeader('from'),
            to: getHeader('to'),
            subject: getHeader('subject'),
            snippet: msgData.snippet,
            body: body.substring(0, 1000) // Truncate body
          });
        }
      }

      if (emails.length === 0) {
        throw new Error("Could not read email contents.");
      }

      // Call our API to summarize
      const summaryRes = await apiFetch('/api/summarize-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });

      if (!summaryRes.ok) {
        const errData = await summaryRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to summarize conversations');
      }

      const summaryData = await summaryRes.json();
      
      const newSummary: ConversationSummary = {
        summary: summaryData.summary,
        nextSteps: summaryData.nextSteps || [],
        lastSyncedAt: new Date().toISOString(),
        lastSyncedByEmail: user?.email || '',
        emailCount: listData.messages.length
      };

      setData(newSummary);
      if (onSyncComplete) {
        onSyncComplete(newSummary);
      }

      // Sync to Firebase directly so it reflects across the firm
      try {
        await updateDoc(doc(db, 'companies', companyId), {
          conversationSummary: newSummary
        });
      } catch (dbErr) {
        console.error("Failed to sync conversation summary to Firebase:", dbErr);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only auto-sync if we don't have initial summary already synced
    if (founderEmail && accessToken && !initialSummary) {
      fetchEmailsAndSummarize();
    }
  }, [founderEmail, accessToken, initialSummary]);

  if (!founderEmail) return null;

  return (
    <div className="bg-white/50 dark:bg-slate-800/50 rounded-lg border border-slate-200/60 dark:border-slate-700/60 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-white/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-md">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">AI Conversation Tracking</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Syncs with Gmail ({founderEmail})</p>
          </div>
        </div>
        <button
          onClick={fetchEmailsAndSummarize}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Sync
        </button>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Analyzing recent emails...</p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Sync Failed</h4>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
              {error.includes('Missing or insufficient') || error.includes('Authentication') ? (
                <button
                  onClick={() => login()}
                  className="mt-3 px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-medium rounded-md hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
                >
                  Reconnect Account
                </button>
              ) : null}
            </div>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Summary</h4>
                <span className="text-[10px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">Based on {emailCount} emails</span>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-900/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800">{data.summary}</p>
            </div>
            
            {data.nextSteps && data.nextSteps.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Next Steps</h4>
                <ul className="space-y-2">
                  {data.nextSteps.map((step, idx) => (
                    <li key={idx} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <span className="text-indigo-500 mt-0.5">•</span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.lastSyncedAt && (
              <div className="pt-3 mt-4 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 flex justify-between pr-1">
                <span>Last synced: {new Date(data.lastSyncedAt).toLocaleString()}</span>
                {data.lastSyncedByEmail && <span>by {data.lastSyncedByEmail}</span>}
              </div>
            )}
          </div>
        ) : !accessToken ? (
          <div className="text-center py-6">
            <Mail className="w-8 h-8 text-slate-400 mx-auto mb-3 opacity-50" />
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Connect Gmail to automatically pull and summarize recent conversations with this founder.</p>
            <button
              onClick={() => login()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              Connect Gmail
            </button>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">No recent conversations found with this founder.</p>
          </div>
        )}
      </div>
    </div>
  );
};
