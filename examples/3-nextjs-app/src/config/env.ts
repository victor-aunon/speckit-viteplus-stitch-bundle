/**
 * Centralized typed environment configuration for Next.js app.
 */
export interface EnvConfig {
  NEXT_PUBLIC_APP_URL: string;
  STRIPE_SECRET_KEY?: string;
}

export const env: EnvConfig = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
};
