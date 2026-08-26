import { apiFetch } from './api';
export const analyzeCompany = async (input: string, type: 'url' | 'raw' | 'deck') => {
  try {
    const response = await apiFetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, type }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    return await response.json();
  } catch (err: any) {
    if (err.message?.includes("unregistered callers") || err.message?.includes("403") || err.message?.includes("API key is missing")) {
      throw new Error("Your Gemini API key is missing or invalid. The server's Gemini API key is not configured. Contact your administrator.");
    }
    throw err;
  }
};
