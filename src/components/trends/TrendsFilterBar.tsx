import { type ReactNode } from 'react';

interface TrendsFilterBarProps {
  children: ReactNode;
  breadcrumb?: ReactNode;
}

export function TrendsFilterBar({ children, breadcrumb }: TrendsFilterBarProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {children}
      </div>
      {breadcrumb && (
        <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1 border-t border-border/20">
          {breadcrumb}
        </div>
      )}
    </div>
  );
}
