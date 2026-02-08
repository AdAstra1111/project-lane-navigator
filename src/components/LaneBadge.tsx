import { MonetisationLane, LANE_LABELS, LANE_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface LaneBadgeProps {
  lane: MonetisationLane;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LaneBadge({ lane, size = 'md', className }: LaneBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5 font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium tracking-tight',
        LANE_COLORS[lane],
        sizeClasses[size],
        className
      )}
    >
      {LANE_LABELS[lane]}
    </span>
  );
}
