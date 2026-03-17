/**
 * CanonDriftBadge — Lightweight CCE (Canon Constraint Enforcement) indicator.
 *
 * Reads version.meta_json.canon_drift and displays:
 * - PASS → subtle green check (or nothing)
 * - WARNINGS ONLY → amber "Canon Warning" badge
 * - VIOLATIONS → red "Canon Drift" badge
 *
 * Tooltip shows violation/warning counts, domains checked, and first findings.
 * Safe fallback: if canon_drift is missing → renders nothing.
 */

import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CanonDriftData {
  passed: boolean;
  violations: number;
  warnings: number;
  domains_checked?: string[];
  checked_at?: string;
  findings?: Array<{
    domain: string;
    severity: string;
    detail: string;
  }>;
}

interface CanonDriftBadgeProps {
  metaJson?: Record<string, any> | null;
  /** Show pass state as subtle green check. Default: false (show nothing on pass) */
  showPass?: boolean;
}

export function CanonDriftBadge({ metaJson, showPass = false }: CanonDriftBadgeProps) {
  if (!metaJson) return null;

  const drift = metaJson.canon_drift as CanonDriftData | undefined;
  if (!drift || typeof drift.passed !== 'boolean') return null;

  const { passed, violations = 0, warnings = 0, domains_checked = [], findings = [] } = drift;

  // PASS — optionally show subtle check
  if (passed && violations === 0) {
    if (!showPass && warnings === 0) return null;

    if (warnings > 0) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 cursor-default"
              >
                <Shield className="h-2.5 w-2.5" />
                Canon Warning
                {warnings > 1 && <span>({warnings})</span>}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
              <DriftTooltipContent drift={drift} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    // Pure pass
    if (showPass) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 cursor-default"
              >
                <ShieldCheck className="h-2.5 w-2.5" />
                Canon OK
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              <p>Canon drift check passed.</p>
              {domains_checked.length > 0 && (
                <p className="text-muted-foreground">
                  Checked: {domains_checked.join(', ')}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return null;
  }

  // VIOLATION — red badge
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 gap-1 border-destructive/50 text-destructive cursor-default"
          >
            <ShieldAlert className="h-2.5 w-2.5" />
            Canon Drift
            {violations > 1 && <span>({violations})</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
          <DriftTooltipContent drift={drift} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DriftTooltipContent({ drift }: { drift: CanonDriftData }) {
  const { violations = 0, warnings = 0, domains_checked = [], findings = [] } = drift;

  return (
    <>
      <div className="font-medium">
        {violations > 0 ? (
          <span className="text-destructive">{violations} violation{violations !== 1 ? 's' : ''}</span>
        ) : null}
        {violations > 0 && warnings > 0 ? ', ' : ''}
        {warnings > 0 ? (
          <span className="text-amber-600 dark:text-amber-400">{warnings} warning{warnings !== 1 ? 's' : ''}</span>
        ) : null}
      </div>
      {domains_checked.length > 0 && (
        <p className="text-muted-foreground">
          Domains: {domains_checked.map(d => d.replace(/_/g, ' ')).join(', ')}
        </p>
      )}
      {findings.slice(0, 2).map((f, i) => (
        <p key={i} className="text-muted-foreground truncate">
          <span className={f.severity === 'violation' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}>
            [{f.domain.replace(/_/g, ' ')}]
          </span>{' '}
          {f.detail.length > 80 ? f.detail.slice(0, 80) + '…' : f.detail}
        </p>
      ))}
      {findings.length > 2 && (
        <p className="text-muted-foreground italic">+{findings.length - 2} more</p>
      )}
    </>
  );
}
