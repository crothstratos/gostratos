import React, { useState } from 'react';
import { Company } from '../types';
import { Download, Search, Star, Target } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn, formatLocation, getFundColorClass } from '../utils';

interface ShortlistTabProps {
  companies: Company[];
  onCompanyClick: (company: Company) => void;
  onUpdateCompany: (company: Company) => void;
}

const EditableDateCell = ({ value, onChange }: { value: string, onChange: (val: string) => void }) => {
  const [localValue, setLocalValue] = useState(value);
  
  React.useEffect(() => { setLocalValue(value); }, [value]);

  return (
    <input
      type="date"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
        if (localValue !== value) {
          onChange(localValue);
        }
      }}
      className="w-full bg-transparent border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 rounded px-2 py-1 text-slate-700 dark:text-slate-300 transition-colors"
    />
  );
};

const EditableNumberCell = ({ value, onChange }: { value: number | undefined, onChange: (val: number | undefined) => void }) => {
  const [localValue, setLocalValue] = useState(value === undefined ? '' : String(value));
  
  React.useEffect(() => { setLocalValue(value === undefined ? '' : String(value)); }, [value]);

  return (
    <div className="flex items-center">
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          const numVal = localValue === '' ? undefined : Number(localValue);
          if (numVal !== value) {
            onChange(numVal);
          }
        }}
        className="w-20 bg-transparent border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 rounded px-2 py-1 text-slate-700 dark:text-slate-300 transition-colors"
      />
      <span className="ml-1 text-slate-500 dark:text-slate-400">%</span>
    </div>
  );
};

const EditableCurrencyCell = ({ value, onChange }: { value: number | undefined, onChange: (val: number | undefined) => void }) => {
  const [localValue, setLocalValue] = useState(value === undefined ? '' : String(value));
  
  React.useEffect(() => { setLocalValue(value === undefined ? '' : String(value)); }, [value]);

  return (
    <div className="flex items-center">
      <span className="mr-1 text-slate-500 dark:text-slate-400">$</span>
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          const numVal = localValue === '' ? undefined : Number(localValue);
          if (numVal !== value) {
            onChange(numVal);
          }
        }}
        className="w-24 bg-transparent border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 rounded px-2 py-1 text-slate-700 dark:text-slate-300 transition-colors"
      />
    </div>
  );
};

export const ShortlistTab: React.FC<ShortlistTabProps> = ({ companies, onCompanyClick, onUpdateCompany }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [fundFilter, setFundFilter] = useState('All Funds');
  const [verticalFilter, setVerticalFilter] = useState('All Verticals');

  const verticals = Array.from(new Set(companies.map(c => c.vertical).filter(Boolean))).sort();
  const shortlistedCompanies = companies.filter(c => c.isShortlisted);

  const filteredCompanies = shortlistedCompanies.filter(c => {
    const searchMatch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        c.basics?.toLowerCase().includes(searchQuery.toLowerCase());
    const fundMatch = fundFilter === 'All Funds' || c.fund === fundFilter || (c.funds && c.funds.includes(fundFilter));
    const verticalMatch = verticalFilter === 'All Verticals' || c.vertical === verticalFilter;
    return searchMatch && fundMatch && verticalMatch;
  });

  const handleExportCSV = () => {
    const csvContent = [
      ['Company Name', 'Investment Amount', 'Target Close Date', 'Probability of Close (%)', 'Short Description'],
      ...filteredCompanies.map(c => [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.investmentAmount || ''}"`,
        `"${c.targetCloseDate || ''}"`,
        `"${c.probabilityOfClose || ''}"`,
        `"${(c.basics || '').replace(/"/g, '""')}"`
      ])
    ].map(e => e.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'shortlist_export.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(16);
    doc.text('Shortlist', 14, 15);
    
    const tableData = filteredCompanies.map(c => [
      c.name,
      c.investmentAmount ? `$${c.investmentAmount.toLocaleString()}` : '-',
      formatLocation(c.location) || '-',
      c.basics || '-'
    ]);

    autoTable(doc, {
      head: [['Company Name', 'Investment Amount', 'Location', 'Short Description']],
      body: tableData,
      startY: 20,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save('shortlist_export.pdf');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Star className="text-indigo-500" />
            Shortlist
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Companies marked for priority review and closing.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <select
            value={fundFilter}
            onChange={(e) => setFundFilter(e.target.value)}
            className="w-full sm:w-48 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="All Funds">All Funds ({shortlistedCompanies.length})</option>
            <option value="Arkansas">Arkansas ({shortlistedCompanies.filter(c => c.fund === 'Arkansas' || (c.funds && c.funds.includes('Arkansas'))).length})</option>
            <option value="Stratos OF">Stratos OF ({shortlistedCompanies.filter(c => c.fund === 'Stratos OF' || (c.funds && c.funds.includes('Stratos OF'))).length})</option>
          </select>
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search shortlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
          </div>
          <div className="flex gap-2 w-full justify-between sm:w-auto">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              <Download size={16} />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              <Download size={16} />
              <span className="hidden sm:inline">PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-300 mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-indigo-500" />
          Target Investment Profile
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 text-sm text-indigo-800 dark:text-indigo-200">
          <div>
            <p className="font-semibold mb-3 text-indigo-950 dark:text-indigo-100 uppercase tracking-wider text-xs">Target Segments & Metrics</p>
            <ul className="list-disc pl-5 space-y-2 marker:text-indigo-400 dark:marker:text-indigo-600">
              <li><span className="font-medium">Enterprise SaaS:</span> Fintech, Insurtech, regulatory technology, horizontal software</li>
              <li>US based</li>
              <li>Recurring revenue $1-3 million</li>
              <li>Series A funding $5-10 million</li>
              <li>Strong Growth & Retention</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-3 text-indigo-950 dark:text-indigo-100 uppercase tracking-wider text-xs">Company Characteristics</p>
            <ul className="list-disc pl-5 space-y-2 marker:text-indigo-400 dark:marker:text-indigo-600">
              <li>Demonstrated product-market fit</li>
              <li>Defensible moat or edge</li>
              <li>Level-headed, pragmatic, and resourceful CEO</li>
              <li>Well organized financials</li>
              <li>Capital efficient</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-4">Company Name</th>
                <th className="px-6 py-4">Investment Amount</th>
                <th className="px-6 py-4">Target Close Date</th>
                <th className="px-6 py-4">Probability of Close (%)</th>
                <th className="px-6 py-4">Short Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                    No shortlisted companies found.
                  </td>
                </tr>
              ) : (
                filteredCompanies.slice(0, 100).map((company) => (
                  <tr key={company.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => onCompanyClick(company)}
                        className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline flex items-center gap-2"
                      >
                        {company.name}
                        {company.fund && !(company.funds && company.funds.length > 0) && (
                          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider no-underline", getFundColorClass(company.fund))}>
                            {company.fund}
                          </span>
                        )}
                        {company.funds && company.funds.map(f => (
                          <span key={f} className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider no-underline", getFundColorClass(f))}>
                            {f}
                          </span>
                        ))}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                      <EditableCurrencyCell 
                        value={company.investmentAmount} 
                        onChange={(val) => onUpdateCompany({ ...company, investmentAmount: val })} 
                      />
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                      <EditableDateCell 
                        value={company.targetCloseDate || ''} 
                        onChange={(val) => onUpdateCompany({ ...company, targetCloseDate: val })} 
                      />
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                      <EditableNumberCell 
                        value={company.probabilityOfClose} 
                        onChange={(val) => onUpdateCompany({ ...company, probabilityOfClose: val })} 
                      />
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400 max-w-md truncate">
                      {company.basics || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
