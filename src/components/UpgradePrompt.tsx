import { useNavigate } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradePromptProps {
  feature: string;
  className?: string;
}

export function UpgradePrompt({ feature, className }: UpgradePromptProps) {
  const navigate = useNavigate();

  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-8 text-center ${className || ''}`}>
      <Crown className="h-8 w-8 text-primary" />
      <h3 className="font-display font-semibold text-foreground">Upgrade to Unlock</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        {feature} is available on Pro and Enterprise plans.
      </p>
      <Button size="sm" onClick={() => navigate('/pricing')}>
        View Plans
      </Button>
    </div>
  );
}
