import { useNavigate, useLocation } from 'react-router-dom';
import { Landmark, Handshake, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TABS = [
  { path: '/incentives', label: 'Incentive Finder', icon: Landmark },
  { path: '/incentives/copro', label: 'Co-Production Planner', icon: Handshake },
  { path: '/incentives/stack', label: 'Stack & Cashflow', icon: Layers },
];

export function IncentiveNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
      {TABS.map(tab => {
        const active = pathname === tab.path;
        return (
          <Button
            key={tab.path}
            variant={active ? 'default' : 'ghost'}
            size="sm"
            onClick={() => navigate(tab.path)}
            className={active ? '' : 'text-muted-foreground'}
          >
            <tab.icon className="h-3.5 w-3.5 mr-1.5" />
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
