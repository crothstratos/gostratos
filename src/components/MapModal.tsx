import React, { useMemo, useState } from 'react';
import { X, Building2 } from 'lucide-react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { Company } from '../types';

interface MapModalProps {
  companies: Company[];
  onClose: () => void;
  onCompanyClick: (company: Company) => void;
}

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

// Simple geocoding map for common US cities and states to prevent needing an API key for demo
const CITY_COORDS: Record<string, [number, number]> = {
  "san francisco": [-122.4194, 37.7749],
  "new york": [-74.0060, 40.7128],
  "boston": [-71.0589, 42.3601],
  "chicago": [-87.6298, 41.8781],
  "austin": [-97.7431, 30.2672],
  "seattle": [-122.3321, 47.6062],
  "los angeles": [-118.2437, 34.0522],
  "atlanta": [-84.3880, 33.7490],
  "denver": [-104.9903, 39.7392],
  "miami": [-80.1918, 25.7617],
  "washington dc": [-77.0369, 38.9072],
};

const STATE_COORDS: Record<string, [number, number]> = {
  "ca": [-119.4179, 36.7783],
  "ny": [-74.0060, 40.7128],
  "tx": [-99.9018, 31.9686],
  "fl": [-81.5158, 27.6648],
  "il": [-89.3985, 40.6331],
  "pa": [-77.1945, 41.2033],
  "oh": [-82.9071, 40.3675],
  "ga": [-83.6431, 32.1656],
  "nc": [-79.0193, 35.7596],
  "mi": [-85.6024, 44.3148],
};

function getCoordinates(locationStr: string): [number, number] | null {
  const lowerLoc = locationStr.toLowerCase();
  
  // Try city match
  for (const city of Object.keys(CITY_COORDS)) {
    if (lowerLoc.includes(city)) return CITY_COORDS[city];
  }
  
  // Try state match
  for (const state of Object.keys(STATE_COORDS)) {
    // Check if it's " , CA" or similar
    if (lowerLoc.includes(` ${state}`) || lowerLoc === state) {
      return STATE_COORDS[state];
    }
  }

  return null;
}

type LocationGroup = {
  coords: [number, number];
  companies: Company[];
};

export function MapModal({ companies, onClose, onCompanyClick }: MapModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<LocationGroup | null>(null);

  const locationGroups = useMemo(() => {
    const groups: Record<string, LocationGroup> = {};
    companies.forEach(company => {
      let coords: [number, number] | null = null;
      if (company.location) {
        if (typeof company.location === 'string') {
          coords = getCoordinates(company.location);
        } else if (company.location.longitude && company.location.latitude) {
          coords = [company.location.longitude, company.location.latitude];
        } else if (company.location.formatted_address) {
          coords = getCoordinates(company.location.formatted_address);
        }
      }
      if (coords) {
        const key = `${coords[0]},${coords[1]}`;
        if (!groups[key]) {
          groups[key] = { coords, companies: [] };
        }
        groups[key].companies.push(company);
      }
    });
    return Object.values(groups);
  }, [companies]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm sm:p-6">
      <div className="flex flex-col w-full max-w-5xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">United States Map</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Showing {locationGroups.reduce((acc, g) => acc + g.companies.length, 0)} companies across {locationGroups.length} locations.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 w-full bg-[#f8fafc] dark:bg-[#0f172a] relative flex flex-col sm:flex-row overflow-hidden">
          <div className="flex-1 w-full h-full relative overflow-hidden flex items-center justify-center">
            <ComposableMap projection="geoAlbersUsa" className="w-[100%] h-[100%] max-h-full">
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map(geo => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#E2E8F0"
                      stroke="#CBD5E1"
                      className="dark:fill-slate-800 dark:stroke-slate-700"
                      style={{
                        default: { outline: "none" },
                        hover: { fill: "#CBD5E1", outline: "none", cursor: "default" },
                        pressed: { outline: "none" },
                      }}
                    />
                  ))
                }
              </Geographies>
              {locationGroups.map(group => {
                const key = `${group.coords[0]},${group.coords[1]}`;
                const isSelected = selectedGroup?.coords[0] === group.coords[0] && selectedGroup?.coords[1] === group.coords[1];
                return (
                  <Marker 
                    key={key} 
                    coordinates={group.coords}
                    onClick={() => setSelectedGroup(group)}
                    className="cursor-pointer"
                  >
                    <circle 
                      r={isSelected ? 8 : 5} 
                      fill={isSelected ? "#2563EB" : "#3B82F6"} 
                      stroke="#fff" 
                      strokeWidth={1.5} 
                      className="transition-all duration-200 hover:fill-blue-600"
                    />
                    <text
                      textAnchor="middle"
                      y={-12}
                      style={{ fontFamily: "Inter, sans-serif", fontSize: "10px", fill: "#334155", fontWeight: 600 }}
                      className="dark:fill-slate-300 pointer-events-none drop-shadow-sm select-none"
                    >
                      {group.companies.length > 1 ? `${group.companies.length} Companies` : group.companies[0].name}
                    </text>
                  </Marker>
                );
              })}
            </ComposableMap>
          </div>
          
          {selectedGroup && (
            <div className="w-full sm:w-80 h-1/3 sm:h-full bg-white dark:bg-slate-900 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-500" />
                  {selectedGroup.companies.length} {selectedGroup.companies.length === 1 ? 'Company' : 'Companies'}
                </h3>
                <button 
                  onClick={() => setSelectedGroup(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {selectedGroup.companies.map(company => (
                  <div 
                    key={company.id} 
                    className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer"
                    onClick={() => {
                      onCompanyClick(company);
                    }}
                  >
                    <h4 className="font-medium text-slate-900 dark:text-white text-sm">{company.name}</h4>
                    {company.vertical && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{company.vertical}</p>
                    )}
                    {(typeof company.location === 'string' ? company.location : company.location?.formatted_address) && (
                       <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">
                         {typeof company.location === 'string' ? company.location : company.location?.formatted_address}
                       </p>
                    )}
                    <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-blue-800 dark:bg-indigo-900/30 dark:text-blue-300">
                      {company.stage}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
