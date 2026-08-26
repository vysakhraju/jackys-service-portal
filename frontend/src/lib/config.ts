// Central place for the two URLs the whole app needs to know about.
// Change these (or the .env file) if the backend ever runs somewhere else.
export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const WS_BASE_URL: string =
  (import.meta as any).env?.VITE_WS_BASE_URL ?? 'http://localhost:3000';
