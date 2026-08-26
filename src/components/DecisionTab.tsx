import React, { useState } from 'react';
import { Company, Stage, STAGES, InteractionLog } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { Save, AlertCircle, ArrowRight, XCircle, Clock } from 'lucide-react';
import { cn } from '../utils';

interface DecisionTabProps {
  company: Company;
  onSaveDecision: (newStage: Stage, interactionNotes: string, decisionDateStr?: string) => void;
}

export const DecisionTab: React.FC<DecisionTabProps> = ({ company, onSaveDecision }) => {
  const [notes, setNotes] = useState('');
  const [decisionDate, setDecisionDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [decision, setDecision] = useState<'partner' | 'watchlist' | 'pass' | null>(null);
  
  // Partner fields
  const [leadPartner, setLeadPartner] = useState('');
  const [coreObjective, setCoreObjective] = useState('');
  
  // Watchlist fields
  const [missingMilestones, setMissingMilestones] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  
  // Pass fields
  const [passReason, setPassReason] = useState('Market too small');
  const [founderFeedback, setFounderFeedback] = useState('');

  const PASS_REASONS = [
    'Market too small',
    'Too early',
    'Outside of thesis',
    'Valuation too high',
    'Conflict of interest',
    'Team execution concerns',
    'Weak unit economics'
  ];

  const handleLogDecision = () => {
    let interactionBody = `**Analyst Notes & Next Steps:**\n${notes}\n\n`;
    let newStage: Stage = company.stage;

    if (decision === 'partner') {
      newStage = 'Partner Call';
      interactionBody += `**Decision:** Promoted to Partner Call\n**Lead Partner:** ${leadPartner}\n**Core Objective:** ${coreObjective}`;
    } else if (decision === 'watchlist') {
      newStage = 'Watchlist';
      interactionBody += `**Decision:** Added to Watchlist\n**Missing Milestones:** ${missingMilestones}\n**Check-in Date:** ${checkInDate}`;
    } else if (decision === 'pass') {
      newStage = 'Passed';
      interactionBody += `**Decision:** Passed\n**Pass Reason:** ${passReason}\n**Founder Feedback:** ${founderFeedback}`;
    }
    
    onSaveDecision(newStage, interactionBody, decisionDate);
    
    // Clear forms (optional, since modal usually closes or refreshes)
    setNotes('');
    setDecision(null);
    setLeadPartner('');
    setCoreObjective('');
    setMissingMilestones('');
    setCheckInDate('');
    setPassReason('Market too small');
    setFounderFeedback('');
  };

  return (
    <div className="space-y-8 pb-8 max-w-4xl mx-auto">
      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Analyst Notes & Next Steps</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Leave any important context or thoughts on this deal.</p>
        
        <div className="bg-slate-50 dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
          <textarea
            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-900 dark:text-white min-h-[120px]"
            placeholder="What are your thoughts on this company? Any specific concerns or follow-ups?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Decision Router</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Select the next step for this company.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button
            type="button"
            onClick={() => setDecision('partner')}
            className={cn(
              "flex flex-col items-center text-center p-4 rounded-xl border-2 transition-all",
              decision === 'partner' 
                ? "border-green-500 bg-green-50 dark:bg-green-900/20" 
                : "border-slate-200 dark:border-slate-800 hover:border-green-300 dark:hover:border-green-700"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mb-2">
              <ArrowRight className="text-green-600 dark:text-green-400" size={20} />
            </div>
            <span className="font-bold text-slate-900 dark:text-white">Promote to Partner</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">Ready for senior review</span>
          </button>
          
          <button
            type="button"
            onClick={() => setDecision('watchlist')}
            className={cn(
              "flex flex-col items-center text-center p-4 rounded-xl border-2 transition-all",
              decision === 'watchlist' 
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20" 
                : "border-slate-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mb-2">
              <Clock className="text-amber-600 dark:text-amber-400" size={20} />
            </div>
            <span className="font-bold text-slate-900 dark:text-white">Add to Watchlist</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">Keep warm & monitor</span>
          </button>

          <button
            type="button"
            onClick={() => setDecision('pass')}
            className={cn(
              "flex flex-col items-center text-center p-4 rounded-xl border-2 transition-all",
              decision === 'pass' 
                ? "border-red-500 bg-red-50 dark:bg-red-900/20" 
                : "border-slate-200 dark:border-slate-800 hover:border-red-300 dark:hover:border-red-700"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center mb-2">
              <XCircle className="text-red-600 dark:text-red-400" size={20} />
            </div>
            <span className="font-bold text-slate-900 dark:text-white">Pass</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">Close the deal loop</span>
          </button>
        </div>

        {decision === 'partner' && (
          <div className="bg-green-50 dark:bg-green-900/10 p-5 rounded-xl border border-green-200 dark:border-green-900/30 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Lead Partner</label>
              <input
                type="text"
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white"
                placeholder="e.g. Sarah or Michael"
                value={leadPartner}
                onChange={(e) => setLeadPartner(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Core Objective</label>
              <textarea
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-900 dark:text-white"
                placeholder="What is the primary risk or question the partner needs to dig into?"
                value={coreObjective}
                onChange={(e) => setCoreObjective(e.target.value)}
              />
            </div>
          </div>
        )}

        {decision === 'watchlist' && (
          <div className="bg-amber-50 dark:bg-amber-900/10 p-5 rounded-xl border border-amber-200 dark:border-amber-900/30 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Missing Milestones</label>
              <textarea
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-900 dark:text-white"
                placeholder="What specifically are we waiting to see before engaging again? (e.g., Hit $50k MRR)"
                value={missingMilestones}
                onChange={(e) => setMissingMilestones(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Check-in Date</label>
              <input
                type="date"
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {decision === 'pass' && (
          <div className="bg-red-50 dark:bg-red-900/10 p-5 rounded-xl border border-red-200 dark:border-red-900/30 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Pass Reason</label>
              <select
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-sm text-slate-900 dark:text-white"
                value={passReason}
                onChange={(e) => setPassReason(e.target.value)}
              >
                {PASS_REASONS.map(reason => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Founder Feedback (Optional)</label>
              <textarea
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-900 dark:text-white"
                placeholder="What to say in the rejection email..."
                value={founderFeedback}
                onChange={(e) => setFounderFeedback(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Decision Date:</label>
          <input
            type="date"
            className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={decisionDate}
            onChange={(e) => setDecisionDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={handleLogDecision}
          disabled={!decision || !notes}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white rounded-lg font-bold shadow-sm transition-all"
        >
          <Save size={18} />
          Log Decision & Move Deal
        </button>
      </div>
    </div>
  );
};
