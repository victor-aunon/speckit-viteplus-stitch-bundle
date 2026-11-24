import React from 'react';

export interface HabitCardProps {
  name: string;
  streakDays: number;
  completedToday: boolean;
  onToggle?: () => void;
}

export const HabitCard: React.FC<HabitCardProps> = ({
  name,
  streakDays,
  completedToday,
  onToggle,
}) => {
  return (
    <article
      data-testid="habit-card"
      style={{
        padding: 'var(--space-md)',
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text)',
      }}
    >
      <h3>{name}</h3>
      <p>Current Streak: {streakDays} days</p>
      <button
        type="button"
        aria-pressed={completedToday}
        onClick={onToggle}
        style={{
          borderRadius: 'var(--radius-sm)',
          backgroundColor: completedToday ? 'var(--color-primary)' : 'transparent',
          color: 'var(--color-text)',
        }}
      >
        {completedToday ? 'Completed' : 'Mark Done'}
      </button>
    </article>
  );
};
