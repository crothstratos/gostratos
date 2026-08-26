import React from 'react';

export function StratosLogo({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Splatter Circle effect */}
      <path 
        d="M200 10C172.386 10 150 32.3858 150 60C150 87.6142 172.386 110 200 110C227.614 110 250 87.6142 250 60C250 32.3858 227.614 10 200 10Z" 
        stroke="#bae6fd" 
        strokeWidth="2" 
        strokeDasharray="8 4 2 4" 
      />
      <circle cx="200" cy="60" r="48" stroke="#bae6fd" strokeWidth="1" opacity="0.8" />
      <circle cx="200" cy="60" r="52" stroke="#bae6fd" strokeWidth="0.5" opacity="0.5" strokeDasharray="2 6" />
      
      {/* STRATOS */}
      <text 
        x="200" 
        y="62" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="56" 
        fontWeight="800" 
        className="fill-[#1e3a5f] dark:fill-white transition-colors"
        textAnchor="middle" 
        letterSpacing="0.1em"
      >
        STRATOS
      </text>
      
      {/* VENTURE PARTNERS */}
      <text 
        x="200" 
        y="92" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="20" 
        fontWeight="700" 
        className="fill-[#1e3a5f] dark:fill-white transition-colors"
        textAnchor="middle" 
        letterSpacing="0.25em"
      >
        VENTURE PARTNERS
      </text>
      
      {/* BEYOND LIMIT */}
      <text 
        x="200" 
        y="112" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="11" 
        fontWeight="500" 
        className="fill-[#64748b] dark:fill-slate-400 transition-colors"
        textAnchor="middle" 
        letterSpacing="0.2em"
      >
        BEYOND LIMIT
      </text>
    </svg>
  );
}
