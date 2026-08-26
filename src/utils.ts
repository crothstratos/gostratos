import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LocationType } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatLocation(location: LocationType | undefined | null): string {
  if (!location) return '';
  if (typeof location === 'string') return location;
  return location.formatted_address || '';
}

export function getFundColorClass(fund?: string | null): string {
  switch (fund) {
    case 'Arkansas':
      return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
    case 'Stratos OF':
      return 'bg-slate-50 text-indigo-700 ring-1 ring-inset ring-blue-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-blue-500/20';
    default:
      return 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-600/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20';
  }
}

export function getInvestorTypeColorClass(type?: string | null): string {
  switch (type) {
    case 'HNWI - Low VC maturity':
      return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-600/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-500/20';
    case 'HNWI - High VC maturity':
      return 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-400 dark:ring-purple-500/20';
    case 'FO - Low VC maturity':
      return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
    case 'FO - High VC maturity':
      return 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20';
    case 'Fund of Funds (FoF)':
      return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/20';
    case 'Institutional (pensions, endowments, foundations)':
      return 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20';
    case 'Corporate':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
    case 'Public (government & public funds)':
      return 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20';
    default:
      return 'bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-600/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20';
  }
}
