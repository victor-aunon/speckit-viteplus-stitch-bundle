import React from 'react';

export interface PricingPlan {
  id: string;
  name: string;
  monthlyPrice: number;
  features: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPrice: 19,
    features: ['Up to 5 projects', 'Community support', 'Basic analytics'],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 49,
    features: ['Unlimited projects', 'Priority support', 'Real-time telemetry'],
  },
];

export default function PricingPage() {
  return (
    <main data-testid="pricing-page">
      <h1>Simple, Transparent Pricing</h1>
      <section>
        {PRICING_PLANS.map((plan) => (
          <article key={plan.id} data-testid={`plan-${plan.id}`}>
            <h2>{plan.name}</h2>
            <p>${plan.monthlyPrice} / month</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
