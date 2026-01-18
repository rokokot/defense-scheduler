/**
 * Centralized helper for determining the backend API URL.
 * Prefer importing `API_BASE_URL` from this module instead of
 * reading `import.meta.env` directly in multiple places.
 */
const resolveApiBaseUrl = () => {
  const envUrl = import.meta?.env?.VITE_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // In DEV mode, use relative URLs so Vite proxy can intercept /api requests.
  // The proxy in vite.config.ts forwards /api to http://localhost:8000.
  if (import.meta?.env?.DEV) {
    return '';
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
};

export const API_BASE_URL = resolveApiBaseUrl();
