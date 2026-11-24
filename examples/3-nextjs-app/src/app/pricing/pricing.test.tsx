import { describe, it, expect } from 'vitest';
import PricingPage, { PRICING_PLANS } from './page.js';

describe('PricingPage Component (Next.js)', () => {
  it('should define pricing plans with positive prices', () => {
    expect(PRICING_PLANS.length).toBeGreaterThan(0);
    PRICING_PLANS.forEach((plan) => {
      expect(plan.monthlyPrice).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
    });
  });

  it('should render pricing page root element', () => {
    const page = PricingPage();
    expect(page).toBeDefined();
    expect(page.props['data-testid']).toBe('pricing-page');
  });
});
