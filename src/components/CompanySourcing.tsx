import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link, UploadCloud, FileText, CheckCircle2, XCircle, Activity, Search, Zap } from 'lucide-react';
import { cn } from '../utils';
import { MOCK_SCAN_RESULT } from '../data';
import { analyzeCompany } from '../services/gemini';

type InputTab = 'url' | 'deck' | 'raw';

interface ScanResult {
  score: number;
  verdict: 'STRONGLY ALIGNED' | 'NEUTRAL' | 'NOT A FIT';
  breakdown: {
    title: string;
    score: number;
    reasoning: string;
  }[];
  pros: string[];
  cons: string[];
}

function AnimatedCounter({ value }: { value: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = value;
    if (start === end) {
      setCount(end);
      return;
    }

    const duration = 1500;
    let startTime: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // easeOutQuart
      const easeProgress = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(easeProgress * end));
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    };
    animationFrameId = window.requestAnimationFrame(step);

    return () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [value]);

  return <span>{count}</span>;
}

export const CompanySourcing = React.memo(function CompanySourcing() {
  const [activeTab, setActiveTab] = useState<InputTab>('url');
  const [inputValue, setInputValue] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleTabChange = React.useCallback((tab: InputTab) => {
    setActiveTab(tab);
    setInputValue('');
    setFileName(null);
    setResult(null);
  }, []);

  const handleFileChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Limit file size to ~100MB to prevent browser/memory crashes, relying on API to enforce token limits
    if (file.size > 100 * 1024 * 1024) {
      alert("This file is too large. Please upload a pitch deck smaller than 100MB.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setInputValue(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAnalyze = React.useCallback(async () => {
    if (!inputValue) return;
    setIsScanning(true);
    setResult(null);
    
    try {
      const data = await analyzeCompany(inputValue, activeTab);
      setResult(data);
    } catch (error: any) {
      console.error("Error analyzing company:", error);
      let errorMessage = error.message || 'Unknown error';
      if (errorMessage.includes("unregistered callers") || errorMessage.includes("403")) {
        errorMessage = "Your Gemini API key is missing or invalid. Please click the Settings icon (gear) in the top right, go to Secrets, and add a valid 'API_KEY'. Then refresh the page.";
      }
      
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        console.warn('Rate limit exceeded. Suppressing error alert.');
      } else {
        alert(`Failed to analyze company: ${errorMessage}`);
      }

    } finally {
      setIsScanning(false);
    }
  }, [inputValue, activeTab]);

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case 'STRONGLY ALIGNED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'NEUTRAL': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'NOT A FIT': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 bg-slate-50/50 dark:bg-slate-950/50 transition-colors duration-200">
      {/* Header */}
      <div className="mb-2">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Investment Alignment Analyzer</h2>
        <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mt-2 max-w-3xl leading-relaxed">
          Evaluate startup fit against Stratos criteria: FinTech/InsurTech/RegTech, Seed/Series A, $500k-$3M, B2B SaaS, US-based.
        </p>
      </div>

      {/* 1. The Ingestion Module */}
      <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 transition-all duration-200">
        <div className="mb-6 flex space-x-1 rounded-lg bg-slate-100/80 dark:bg-slate-800/80 p-1 w-fit border border-slate-200/50 dark:border-slate-700/50">
          <button
            onClick={() => handleTabChange('url')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
              activeTab === 'url' ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            )}
          >
            <Link size={16} /> URL
          </button>
          <button
            onClick={() => handleTabChange('deck')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
              activeTab === 'deck' ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            )}
          >
            <UploadCloud size={16} /> Pitch Deck
          </button>
          <button
            onClick={() => handleTabChange('raw')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
              activeTab === 'raw' ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            )}
          >
            <FileText size={16} /> Raw Data
          </button>
        </div>

        <div className="mb-6">
          {activeTab === 'url' && (
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="url"
                placeholder="https://startup-website.com"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/50 py-3.5 pl-12 pr-4 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:text-slate-100 dark:placeholder-slate-500 transition-all shadow-sm"
              />
            </div>
          )}
          {activeTab === 'deck' && (
            <div 
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30 py-14 transition-all hover:border-blue-400 dark:hover:border-indigo-500 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={handleFileChange}
              />
              <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300 ring-1 ring-slate-900/5 dark:ring-white/10">
                <UploadCloud size={32} className={cn(fileName ? "text-indigo-500" : "text-slate-400 dark:text-slate-500")} />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {fileName ? fileName : "Drag & Drop Pitch Deck (PDF/PPTX)"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {fileName ? "Click to change file" : "or click to browse files"}
              </p>
            </div>
          )}
          {activeTab === 'raw' && (
            <textarea
              placeholder="Paste LinkedIn profiles, executive summaries, or raw notes here..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-300/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/50 p-4 focus:border-indigo-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:text-slate-100 dark:placeholder-slate-500 transition-all shadow-sm resize-y"
            />
          )}
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isScanning || !inputValue}
          className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-slate-900 dark:bg-indigo-600 px-6 py-3.5 font-semibold text-white transition-all hover:bg-slate-800 dark:hover:bg-indigo-700 hover:shadow-md disabled:opacity-70"
        >
          {isScanning ? (
            <>
              <Activity className="animate-pulse" size={20} />
              Scanning & Analyzing...
              <motion.div 
                className="absolute inset-0 bg-white/10"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              />
            </>
          ) : (
            <>
              <Zap size={20} />
              Analyze Alignment
            </>
          )}
        </button>
      </div>

      {/* 2. The Visual Comparison Engine */}
      <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 sm:p-8 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/5 transition-all duration-200">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">Investment Fit Score</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Based on Stratos core thesis criteria</p>
          </div>
          {result ? (
            <div className={cn("rounded-full border px-4 py-1.5 text-sm font-bold tracking-wide shadow-sm", getVerdictColor(result.verdict))}>
              {result.verdict}
            </div>
          ) : (
            <div className="rounded-full border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/50 px-4 py-1.5 text-sm font-bold tracking-wide text-slate-400 dark:text-slate-500 shadow-sm">
              AWAITING DATA
            </div>
          )}
        </div>

        {/* Dynamic Alignment Bar */}
        <div className="relative mb-12 pt-8">
          {/* Background Bar */}
          <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800/50 ring-1 ring-inset ring-slate-900/5 dark:ring-white/5">
            <div 
              className={cn(
                "h-full w-full opacity-20 transition-all duration-1000",
                result ? "opacity-100" : ""
              )}
              style={{
                background: 'linear-gradient(90deg, #EF4444 0%, #F59E0B 50%, #10B981 100%)'
              }}
            />
          </div>
          
          {/* Indicator Needle */}
          <motion.div 
            className="absolute top-0 -ml-3 flex flex-col items-center"
            initial={{ left: '0%' }}
            animate={{ left: result ? `${result.score}%` : '0%' }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          >
            <div className={cn(
              "mb-1 flex h-8 w-12 items-center justify-center rounded-lg bg-slate-900 dark:bg-white text-sm font-bold text-white dark:text-slate-900 shadow-lg transition-opacity ring-1 ring-slate-900/5 dark:ring-white/10",
              result ? "opacity-100" : "opacity-30"
            )}>
              {result ? <><AnimatedCounter value={result.score} />%</> : '0%'}
            </div>
            <div className={cn(
              "h-6 w-1 rounded-full bg-slate-900 dark:bg-white shadow-[0_0_8px_rgba(15,23,42,0.5)] dark:shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-opacity",
              result ? "opacity-100" : "opacity-30"
            )} />
          </motion.div>
        </div>

        {/* Score Breakdown Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {(result?.breakdown || MOCK_SCAN_RESULT.breakdown).map((item, idx) => (
            <div key={idx} className={cn(
              "rounded-lg border border-slate-200/60 dark:border-slate-800/60 bg-white/50 dark:bg-slate-900/50 p-5 transition-opacity shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 duration-200",
              !result ? "opacity-40 grayscale" : ""
            )}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">{item.title}</span>
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">{result ? item.score : 0}%</span>
              </div>
              <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800/50 ring-1 ring-inset ring-slate-900/5 dark:ring-white/5">
                <motion.div 
                  className={cn("h-full rounded-full", getScoreColor(item.score))}
                  initial={{ width: '0%' }}
                  animate={{ width: result ? `${item.score}%` : '0%' }}
                  transition={{ duration: 1, delay: 0.2 + idx * 0.1 }}
                />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{item.reasoning}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Alignment Summary & "Why" Section */}
      <div className={cn(
        "grid grid-cols-1 gap-6 md:grid-cols-2 transition-opacity duration-500",
        !result ? "opacity-30 pointer-events-none grayscale" : "opacity-100"
      )}>
        {/* Left Column: Pros */}
        <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-900/10 p-6 sm:p-8 shadow-sm">
          <h4 className="mb-6 flex items-center gap-2.5 font-bold text-emerald-900 dark:text-emerald-400 text-lg">
            <CheckCircle2 className="text-emerald-500" size={24} />
            Why it fits your thesis
          </h4>
          <ul className="space-y-4">
            {(result?.pros || MOCK_SCAN_RESULT.pros).map((pro, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm sm:text-base text-emerald-800 dark:text-emerald-300 leading-relaxed">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-sm" />
                {pro}
              </li>
            ))}
          </ul>
        </div>

        {/* Right Column: Cons */}
        <div className="rounded-xl border border-red-200/60 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 p-6 sm:p-8 shadow-sm">
          <h4 className="mb-6 flex items-center gap-2.5 font-bold text-red-900 dark:text-red-400 text-lg">
            <XCircle className="text-red-500" size={24} />
            Potential Red Flags / Deviations
          </h4>
          <ul className="space-y-4">
            {(result?.cons || MOCK_SCAN_RESULT.cons).map((con, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm sm:text-base text-red-800 dark:text-red-300 leading-relaxed">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow-sm" />
                {con}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
});
