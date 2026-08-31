import { apiFetch } from '../services/api';
import { useState } from 'react';

export function useGemini() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAutoPopulate = async (notes: string, onDataExtracted: (data: any) => void) => {
    if (!notes.trim()) {
      setError('Please enter some notes or data to auto-populate.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await apiFetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const extractedData = await response.json();
      onDataExtracted(extractedData);
    } catch (err: any) {
      console.error('Failed to auto-populate:', err);
      let errorMessage = err.message || 'Unknown error';
      if (errorMessage.includes("unregistered callers") || errorMessage.includes("403") || errorMessage.includes("API key is missing")) {
        errorMessage = "Your Gemini API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator.";
      }
      
      // Rate-limit and quota errors used to be swallowed into a console
      // warning, so the user saw a spinner stop and nothing else — and
      // nobody could tell that AI spend was being throttled. They are the
      // most likely failure here, so they get the clearest message.
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else {
        setError(`Failed to auto-populate: ${errorMessage}`);
      }

    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateDescription = async (name: string, website: string, onDescriptionGenerated: (description: string) => void) => {
    if (!name || !website) {
      setError('Company name and website are required to generate a description.');
      return;
    }

    setIsGeneratingDescription(true);
    setError(null);

    try {
      const response = await apiFetch('/api/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, website }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (data.description) {
        onDescriptionGenerated(data.description);
      }
    } catch (err: any) {
      console.error('Failed to generate description:', err);
      let errorMessage = err.message || 'Unknown error';
      if (errorMessage.includes("unregistered callers") || errorMessage.includes("403") || errorMessage.includes("API key is missing")) {
        errorMessage = "Your Gemini API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator.";
      }
      
      // Rate-limit and quota errors used to be swallowed into a console
      // warning, so the user saw a spinner stop and nothing else — and
      // nobody could tell that AI spend was being throttled. They are the
      // most likely failure here, so they get the clearest message.
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else {
        setError(`Failed to generate description: ${errorMessage}`);
      }

    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleScanWebsite = async (website: string, onDataExtracted: (data: any) => void) => {
    if (!website) return;
    
    let url = website;
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    setIsScanning(true);
    setError(null);
    try {
      const response = await apiFetch('/api/scan-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      onDataExtracted(data);
    } catch (err: any) {
      console.error("Error scanning website:", err);
      let errorMessage = err.message || 'Unknown error';
      if (errorMessage.includes("unregistered callers") || errorMessage.includes("403") || errorMessage.includes("API key is missing")) {
        errorMessage = "Your Gemini API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator.";
      }
      
      // Rate-limit and quota errors used to be swallowed into a console
      // warning, so the user saw a spinner stop and nothing else — and
      // nobody could tell that AI spend was being throttled. They are the
      // most likely failure here, so they get the clearest message.
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else {
        setError(`Failed to scan website: ${errorMessage}`);
      }

    } finally {
      setIsScanning(false);
    }
  };

  const handlePitchDeckExtract = async (file: File, onDataExtracted: (data: any) => void) => {
    setIsGenerating(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target?.result as string;
          const response = await apiFetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'deck', input: base64Data }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
          }

          const extractedData = await response.json();
          onDataExtracted(extractedData);
        } catch (err: any) {
          console.error("Failed to extract deck:", err);
          let errorMessage = err.message || 'Unknown error';
          if (errorMessage.includes("unregistered callers") || errorMessage.includes("403") || errorMessage.includes("API key is missing")) {
            errorMessage = "Your Gemini API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator.";
          }
          
      // Rate-limit and quota errors used to be swallowed into a console
      // warning, so the user saw a spinner stop and nothing else — and
      // nobody could tell that AI spend was being throttled. They are the
      // most likely failure here, so they get the clearest message.
      if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429') || errorMessage.toLowerCase().includes('exhausted')) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else {
        setError(`Failed to extract pitch deck: ${errorMessage}`);
      }

        } finally {
          setIsGenerating(false);
        }
      };
      reader.onerror = () => {
        throw new Error('Failed to read file');
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(`Failed to read file: ${err.message}`);
      setIsGenerating(false);
    }
  };

  
  const handleDiscoverCoinvestors = async (companyName: string, companyDescription: string, vertical: string, onDataExtracted: (data: any) => void, onError?: (err: any) => void) => {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await apiFetch('/api/discover-coinvestors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, companyDescription, vertical })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      onDataExtracted(data);
    } catch (err: any) {
      
      const msg = err.message || 'An error occurred during AI extraction.';
      // See the other handlers in this file: rate-limit errors are the most
      // likely failure and were the one thing the user never got told about.
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('429') || msg.toLowerCase().includes('exhausted')) {
        setError('Too many AI requests in a short time. Please wait a minute and try again.');
      } else {
        setError(msg);
      }

      console.error(err);
      if (onError) onError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    isGenerating,
    isGeneratingDescription,
    isScanning,
    error,
    setError,
    handleAutoPopulate,
    handleGenerateDescription,
    handleScanWebsite,
    handleDiscoverCoinvestors,
    handlePitchDeckExtract
  };
}
