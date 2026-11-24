/**
 * Centralized typed environment configuration for Vanilla Web component.
 */
export interface EnvConfig {
  MODE: string;
  APP_ENV: string;
}

export const env: EnvConfig = {
  MODE: import.meta.env?.MODE || 'production',
  APP_ENV: import.meta.env?.APP_ENV || 'production',
};
