/**
 * Centralized typed environment configuration for API service.
 */
export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  JWT_SECRET: string;
}

export const env: EnvConfig = {
  NODE_ENV: (process.env.NODE_ENV as EnvConfig['NODE_ENV']) || 'test',
  PORT: parseInt(process.env.PORT || '3000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'super-secret-default-key-for-testing-only',
};
