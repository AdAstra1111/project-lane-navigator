/**
 * Pre-Production Intelligence Panel
 *
 * Displays: sensitivity modelling, cost-risk heat map,
 * completion bond checklist, legal/insurance readiness, HOD hiring tracker.
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, Shield, Scale, Users, CheckCircle2,
  Circle, AlertTriangle, XCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ProjectHOD } from '@/hooks/useProjectAttachments';
import {
  generateSensitivityScenarios,
  calculateDepartmentRisks,
  BOND_CHECKLIST,
  calculateHODHiringStatus,
  type SensitivityScenario,
  type DepartmentRisk,
  type BondChecklistItem,
  type HODHiringStatus,
} from '@/lib/prepro-intelligence';

interface Props {
  format: string;
  hods: ProjectHOD[];
  totalBudget: number | undefined;
  dealCount: number;
  cashflowCoverage: number;
  budgetLines: Array<{ category: string; amount: number }>;
  bondChecked: string[];
  onToggleBondItem: (id: string) => void;
}

export function PreProductionIntelligencePanel({
  format, hods, totalBudget, dealCount, cashflowCoverage,
  budgetLines, bondChecked, onToggleBondItem,
}: Props) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sensitivity: true, risk: false, bond: false, hiring: true,
  });

  const scenarios = useMemo(
    () => generateSensitivityScenarios(totalBudget, dealCount, cashflowCoverage),
    [totalBudget, dealCount, cashflowCoverage],
  );
  const deptRisks = useMemo(
    () => calculateDepartmentRisks(format, budgetLines, totalBudget),
    [format, budgetLines, totalBudget],
  );
  const hiringStatus = useMemo(
    () => calculateHODHiringStatus(hods, format),
    [hods, format],
  );

  const bondProgress = useMemo(() => {
    const required = BOND_CHECKLIST.filter(i => i.required);
    const checked = required.filter(i => bondChecked.includes(i.id));
    return { total: required.length, done: checked.length, pct: required.length > 0 ? Math.round((checked.length / required.length) * 100) : 0 };
  }, [bondChecked]);

  const hiringPct = useMemo(() => {
    const hired = hiringStatus.filter(h => h.status === 'hired').length;
    return hiringStatus.length > 0 ? Math.round((hired / hiringStatus.length) * 100) : 0;
  }, [hiringStatus]);

  const toggle = (key: string) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* ── Sensitivity Modelling ── */}
      <SectionCard
        icon={Activity}
        title="Sensitivity Modelling"
        badge={totalBudget ? undefined : 'No budget locked'}
        open={openSections.sensitivity}
        onToggle={() => toggle('sensitivity')}
      >
        <div className="space-y-2">
          {scenarios.map((s, i) => (
            <ScenarioRow key={i} scenario={s} />
          ))}
        </div>
      </SectionCard>

      {/* ── Cost-Risk Heat Map ── */}
      <SectionCard
        icon={AlertTriangle}
        title="Cost-Risk Heat Map"
        badge={`${deptRisks.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length} high-risk depts`}
        open={openSections.risk}
        onToggle={() => toggle('risk')}
      >
        <div className="space-y-1.5">
          {deptRisks
            .sort((a, b) => riskOrder(b.riskLevel) - riskOrder(a.riskLevel))
            .map((r, i) => (
              <RiskRow key={i} risk={r} />
            ))}
        </div>
      </SectionCard>

      {/* ── Completion Bond & Legal ── */}
      <SectionCard
        icon={Shield}
        title="Bond & Legal Readiness"
        badge={`${bondProgress.pct}% complete`}
        open={openSections.bond}
        onToggle={() => toggle('bond')}
      >
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{bondProgress.done}/{bondProgress.total} required items</span>
            <span className={`font-medium ${bondProgress.pct >= 80 ? 'text-emerald-400' : bondProgress.pct >= 50 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {bondProgress.pct}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60 transition-all"
              style={{ width: `${bondProgress.pct}%` }}
            />
          </div>
        </div>
        {(['financial', 'creative', 'legal', 'insurance'] as const).map(cat => (
          <div key={cat} className="mb-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider capitalize">{cat}</span>
            <div className="space-y-1 mt-1">
              {BOND_CHECKLIST.filter(i => i.category === cat).map(item => (
                <BondItemRow
                  key={item.id}
                  item={item}
                  checked={bondChecked.includes(item.id)}
                  onToggle={() => onToggleBondItem(item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionCard>

      {/* ── HOD Hiring Tracker ── */}
      <SectionCard
        icon={Users}
        title="Department Head Hiring"
        badge={`${hiringPct}% filled`}
        open={openSections.hiring}
        onToggle={() => toggle('hiring')}
      >
        <div className="space-y-1.5">
          {hiringStatus.map((h, i) => (
            <HiringRow key={i} status={h} />
          ))}
        </div>
      </SectionCard>
    </motion.div>
  );
}

// ---- Sub-Components ----

function SectionCard({
  icon: Icon, title, badge, open, onToggle, children,
}: {
  icon: React.ElementType; title: string; badge?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <div className="glass-card rounded-xl overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <span className="font-display font-semibold text-foreground text-sm">{title}</span>
            {badge && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">
                {badge}
              </Badge>
            )}
          </div>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-5 pb-4">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ScenarioRow({ scenario }: { scenario: SensitivityScenario }) {
  const impactColors = {
    minimal: 'text-emerald-400',
    moderate: 'text-amber-400',
    severe: 'text-red-400',
  };
  return (
    <div className="bg-muted/20 rounded-lg px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-foreground">{scenario.label}</span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${impactColors[scenario.cashflowImpact]}`}>
          {scenario.cashflowImpact} impact
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{scenario.description}</p>
      {scenario.recoupmentShift !== 0 && (
        <span className="text-[10px] text-muted-foreground mt-1 block">
          Recoupment: {scenario.recoupmentShift > 0 ? '+' : ''}{scenario.recoupmentShift} months
        </span>
      )}
    </div>
  );
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/20',
  medium: 'bg-amber-500/20',
  high: 'bg-orange-500/20',
  critical: 'bg-red-500/20',
};

const RISK_TEXT: Record<string, string> = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

function riskOrder(level: string): number {
  return { critical: 3, high: 2, medium: 1, low: 0 }[level] || 0;
}

function RiskRow({ risk }: { risk: DepartmentRisk }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2 cursor-default">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${RISK_COLORS[risk.riskLevel]}`} />
            <span className="text-sm text-foreground flex-1">{risk.department}</span>
            <span className="text-[10px] text-muted-foreground">{Math.round(risk.budgetShare * 100)}%</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize ${RISK_TEXT[risk.riskLevel]}`}>
              {risk.riskLevel}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs max-w-[250px]">
          {risk.riskFactors.length > 0 && (
            <div className="mb-1">
              <strong>Risks:</strong> {risk.riskFactors.join('; ')}
            </div>
          )}
          {risk.mitigations.length > 0 && (
            <div>
              <strong>Mitigations:</strong> {risk.mitigations.join('; ')}
            </div>
          )}
          {risk.riskFactors.length === 0 && <span>No significant risk factors identified.</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BondItemRow({ item, checked, onToggle }: { item: BondChecklistItem; checked: boolean; onToggle: () => void }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            className="flex items-center gap-2 w-full text-left bg-muted/10 hover:bg-muted/20 rounded-lg px-3 py-1.5 transition-colors"
          >
            {checked ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : item.required ? (
              <XCircle className="h-3.5 w-3.5 text-red-400/50 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className={`text-xs flex-1 ${checked ? 'text-foreground line-through opacity-60' : 'text-foreground'}`}>
              {item.label}
            </span>
            {item.required && !checked && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-400 border-red-400/30">
                Required
              </Badge>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs max-w-[200px]">
          {item.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const HIRING_STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  hired: { icon: CheckCircle2, color: 'text-emerald-400' },
  'in-talks': { icon: Activity, color: 'text-amber-400' },
  searching: { icon: Circle, color: 'text-sky-400' },
  vacant: { icon: XCircle, color: 'text-red-400/50' },
};

function HiringRow({ status }: { status: HODHiringStatus }) {
  const config = HIRING_STATUS_CONFIG[status.status];
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-foreground block truncate">{status.department}</span>
        {status.personName && (
          <span className="text-[10px] text-muted-foreground">{status.personName}</span>
        )}
      </div>
      {status.critical && status.status !== 'hired' && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-400 border-amber-500/30">
          Critical
        </Badge>
      )}
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize ${config.color}`}>
        {status.status}
      </Badge>
    </div>
  );
}
