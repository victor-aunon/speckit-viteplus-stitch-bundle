/**
 * Centralized typed environment configuration for React client SPA.
 */
export interface EnvConfig {
  MODE: string;
  VITE_API_URL: string;
}

export const env: EnvConfig = {
  MODE: import.meta.env?.MODE || 'test',
  VITE_API_URL: import.meta.env?.VITE_API_URL || 'https://api.example.com',
};
