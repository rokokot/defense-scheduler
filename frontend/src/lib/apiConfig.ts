/**
 * Centralized helper for determining the backend API URL.
 * Prefer importing `API_BASE_URL` from this module instead of
 * reading `import.meta.env` directly in multiple places.
 */
const resolveApiBaseUrl = () => {
  if (import.meta?.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }

  return 'http://localhost:8000';
};

export const API_BASE_URL = resolveApiBaseUrl();
