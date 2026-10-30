const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredBaseUrl ||
  (import.meta.env.PROD
    ? "https://voice-ai-backend-xu50.onrender.com"
    : "http://127.0.0.1:8000")
).replace(/\/+$/, "");

export const API_URLS = {
  health: `${API_BASE_URL}/health`,
  voiceSession: `${API_BASE_URL}/api/v1/voice/session`,
};
