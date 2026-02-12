import { cn } from '@/lib/utils';
import { 
  LIFECYCLE_STAGES, 
  type LifecycleStage, 
  getStageOrder, 
  isStageAccessible 
} from '@/lib/lifecycle-stages';
import { Lock, Check, DollarSign, TrendingUp, Wallet, Calculator, PieChart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface LifecycleSidebarProps {
  currentLifecycleStage: LifecycleStage;
  activeView: string;
  onViewChange: (view: string) => void;
  stageScores?: Record<LifecycleStage, number>;
}

export function LifecycleSidebar({ 
  currentLifecycleStage, 
  activeView, 
  onViewChange,
  stageScores,
}: LifecycleSidebarProps) {
  const currentOrder = getStageOrder(currentLifecycleStage);

  return (
    <nav className="w-56 shrink-0 space-y-1 sticky top-20">
      {/* Overview */}
      <button
        onClick={() => onViewChange('overview')}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          activeView === 'overview'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <TrendingUp className="h-4 w-4 shrink-0" />
        <span>Overview</span>
      </button>

      {/* Divider */}
      <div className="h-px bg-border my-2" />

      {/* Lifecycle Stages */}
      {LIFECYCLE_STAGES.map((stage) => {
        const accessible = isStageAccessible(stage.value, currentLifecycleStage);
        const isComplete = stage.order < currentOrder;
        const isCurrent = stage.value === currentLifecycleStage;
        const isActive = activeView === stage.value;
        const score = stageScores?.[stage.value];

        return (
          <Tooltip key={stage.value} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => accessible && onViewChange(stage.value)}
                disabled={!accessible}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors group',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : accessible
                    ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    : 'text-muted-foreground/40 cursor-not-allowed'
                )}
              >
                <div className="relative shrink-0">
                  {!accessible ? (
                    <Lock className="h-4 w-4" />
                  ) : isComplete ? (
                    <div className="h-4 w-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                    </div>
                  ) : (
                    <stage.icon className={cn('h-4 w-4', isCurrent && 'text-primary')} />
                  )}
                </div>
                <span className="flex-1 text-left truncate">{stage.label}</span>
                {score !== undefined && accessible && (
                  <Badge 
                    variant="outline" 
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-5 font-mono',
                      score >= 75 ? 'border-emerald-500/30 text-emerald-400' :
                      score >= 50 ? 'border-amber-500/30 text-amber-400' :
                      'border-muted text-muted-foreground'
                    )}
                  >
                    {score}%
                  </Badge>
                )}
                {isCurrent && !isActive && (
                  <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              <p className="font-medium">{stage.label}</p>
              <p className="text-muted-foreground">{stage.description}</p>
              {!accessible && <p className="text-amber-400 mt-1">Complete prior stages to unlock</p>}
            </TooltipContent>
          </Tooltip>
        );
      })}

      {/* Divider */}
      <div className="h-px bg-border my-2" />

      {/* Persistent layers */}
      <button
        onClick={() => onViewChange('financing')}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          activeView === 'financing'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <Wallet className="h-4 w-4 shrink-0" />
        <span>Financing</span>
      </button>

      <button
        onClick={() => onViewChange('budgeting')}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          activeView === 'budgeting'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <Calculator className="h-4 w-4 shrink-0" />
        <span>Budgeting</span>
      </button>

      <button
        onClick={() => onViewChange('recoupment')}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          activeView === 'recoupment'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <PieChart className="h-4 w-4 shrink-0" />
        <span>Recoupment</span>
      </button>

      {/* Divider */}
      <div className="h-px bg-border my-2" />

      <button
        onClick={() => onViewChange('trends')}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          activeView === 'trends'
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <TrendingUp className="h-4 w-4 shrink-0" />
        <span>Trends Engine</span>
      </button>
    </nav>
  );
}
