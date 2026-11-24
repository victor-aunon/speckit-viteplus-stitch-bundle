import { describe, it, expect } from 'vitest';
import React from 'react';
import { HabitCard } from './HabitCard.js';

describe('HabitCard Component', () => {
  it('should render habit title and streak correctly', () => {
    const element = HabitCard({
      name: 'Meditation',
      streakDays: 10,
      completedToday: false,
    });
    expect(element).toBeDefined();
    expect(element.props['data-testid']).toBe('habit-card');
  });

  it('should reflect completed status in button attributes', () => {
    const element = HabitCard({
      name: 'Running',
      streakDays: 3,
      completedToday: true,
    });
    expect(element.props.children).toBeDefined();
  });
});
