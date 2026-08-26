import React, { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { LocationType } from '../types';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

declare global {
  interface Window {
    google: any;
  }
}

interface LocationInputProps {
  value: LocationType | undefined;
  onChange: (value: LocationType) => void;
  className?: string;
  placeholder?: string;
}

export function LocationInput({ value, onChange, className = '', placeholder = 'Enter location...' }: LocationInputProps) {
  const getDisplayValue = (val: LocationType | undefined) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    return val.formatted_address || '';
  };

  const [query, setQuery] = useState(getDisplayValue(value));
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  
  const autocompleteService = useRef<any>(null);
  const placesService = useRef<any>(null);
  const sessionToken = useRef<any>(null);
  const OK_STATUS = useRef<string | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    setQuery(getDisplayValue(value));
  }, [value]);

  useEffect(() => {
    if (!apiKey) return;

    let isMounted = true;

    const initServices = async () => {
      try {
        setOptions({ key: apiKey, version: "weekly" });
        await importLibrary("places");
        const google = window.google;
        const { AutocompleteService, PlacesService, AutocompleteSessionToken } = google.maps.places;
        
        if (!isMounted) return;

        autocompleteService.current = new AutocompleteService();
        placesService.current = new PlacesService(document.createElement('div'));
        sessionToken.current = new AutocompleteSessionToken();
        OK_STATUS.current = window.google?.maps?.places?.PlacesServiceStatus?.OK || "OK";
      } catch (error) {
        console.error("Error loading Google Maps Places API:", error);
      }
    };

    initServices();

    return () => {
      isMounted = false;
    };
  }, [apiKey]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val); // Update parent with raw string while typing

    if (!val.trim() || !autocompleteService.current) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    autocompleteService.current.getPlacePredictions(
      { 
        input: val, 
        types: ['(regions)'],
        sessionToken: sessionToken.current
      },
      (predictions: any[], status: any) => {
        if (status === OK_STATUS.current && predictions) {
          setSuggestions(predictions);
          setIsOpen(true);
        } else {
          setSuggestions([]);
          setIsOpen(false);
        }
      }
    );
  };

  const handleSelectSuggestion = (suggestion: any) => {
    setQuery(suggestion.description);
    setIsOpen(false);
    
    // Refresh token after a selection
    if (window.google?.maps?.places?.AutocompleteSessionToken) {
      sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();
    }

    if (!placesService.current) {
      onChange(suggestion.description);
      return;
    }

    placesService.current.getDetails(
      { 
        placeId: suggestion.place_id, 
        fields: ['address_components', 'formatted_address', 'geometry', 'place_id', 'name'],
        sessionToken: sessionToken.current 
      },
      (place: any, status: any) => {
        if (status === OK_STATUS.current && place) {
          let city = null;
          let state = null;
          let zip_code = null;
          let country = null;

          if (place.address_components) {
            place.address_components.forEach((component: any) => {
              const types = component.types;
              if (types.includes('locality') || types.includes('postal_town')) {
                city = component.long_name;
              }
              if (types.includes('administrative_area_level_1')) {
                state = component.short_name;
              }
              if (types.includes('postal_code')) {
                zip_code = component.long_name;
              }
              if (types.includes('country')) {
                country = component.short_name;
              }
            });
          }

          const isUS = country === 'US';
          let locationValue: LocationType;

          if (isUS) {
            locationValue = {
              formatted_address: place.formatted_address || null,
              latitude: place.geometry?.location?.lat() || null,
              longitude: place.geometry?.location?.lng() || null,
              place_id: place.place_id || null,
              city: city,
              state: state,
              zip_code: zip_code
            };
          } else {
            locationValue = place.formatted_address || place.name || suggestion.description;
          }

          setQuery(getDisplayValue(locationValue));
          onChange(locationValue);
        } else {
          onChange(suggestion.description);
        }
      }
    );
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        className={`${className} !pl-9`}
        placeholder={apiKey ? placeholder : placeholder + " (API Key missing)"}
      />
      
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.place_id}
              onClick={() => handleSelectSuggestion(suggestion)}
              className="px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer text-sm text-slate-700 dark:text-slate-300"
            >
              {suggestion.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
