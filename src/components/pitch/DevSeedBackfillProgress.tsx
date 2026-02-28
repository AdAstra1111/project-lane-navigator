/**
 * DevSeedBackfillProgress — Human-clear progress panel for DevSeed backfill.
 *
 * Shows:
 *  - Narrative status banner ("what's happening / what's blocked / what's done")
 *  - Dual progress bars: Foundation Convergence + Development Pack
 *  - Grouped per-doc rows with gate badges, deep links, version info
 *  - Explicit blocker panel with actionable CTAs
 */
import { useState } from 'react';
import {
  CheckCircle, XCircle, Loader2, Clock, Pause, Play,
  ExternalLink, AlertTriangle, ShieldAlert, ChevronDown,
  ChevronRight, History, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { DevSeedJob, DevSeedJobItem } from '@/hooks/useDevSeedBackfill';
import {
  labelForDocType, labelForItemKey, verbForStatus,
  summarizeFailures, derivePhase, groupDevpackItems,
  narrativeCurrentStep,
} from '@/lib/backfillLabels';

/* ── Types ────────────────────────────────────────────────── */

interface Props {
  job: DevSeedJob;
  items: DevSeedJobItem[];
  isRunning: boolean;
  onPause: () => void;
  onResume: () => void;
  projectId?: string;
}

interface Blocker {
  type: string;
  doc_type: string;
  item_key: string;
  gate_failures?: string[];
  output_doc_id?: string;
  output_version_id?: string;
}

/* ── Status icon map ──────────────────────────────────────── */

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued:   <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  claimed:  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  running:  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  complete: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  failed:   <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

/* ── Helpers ──────────────────────────────────────────────── */

function docLink(projectId: string | undefined, docId: string | null | undefined, versionId: string | null | undefined): string | null {
  if (!projectId || !docId) return null;
  let url = `/projects/${projectId}/development?doc=${docId}`;
  if (versionId) url += `&version=${versionId}`;
  return url;
}

function historyLink(projectId: string | undefined, docId: string | null | undefined): string | null {
  if (!projectId || !docId) return null;
  return `/projects/${projectId}/development?doc=${docId}&tab=versions`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export function DevSeedBackfillProgress({ job, items, isRunning, onPause, onResume, projectId }: Props) {
  const [rawOpen, setRawOpen] = useState(false);

  // ── Derive phases ──
  const foundation = items.filter(i => derivePhase(i as any) === 'foundation');
  const devpack    = items.filter(i => derivePhase(i as any) === 'devpack');

  const fDone   = foundation.filter(i => i.status === 'complete').length;
  const fFailed = foundation.filter(i => i.status === 'failed').length;
  const fTotal  = foundation.length;
  const fPct    = fTotal > 0 ? Math.round((fDone / fTotal) * 100) : 0;

  const dDone   = devpack.filter(i => i.status === 'complete' || i.status === 'failed').length;
  const dFailed = devpack.filter(i => i.status === 'failed').length;
  const dTotal  = devpack.length;
  const dPct    = dTotal > 0 ? Math.round((dDone / dTotal) * 100) : 0;

  const isBlocked = job.status === 'paused_blocked';
  const isPaused  = job.status === 'paused';
  const isDone    = job.status === 'complete';
  const isFailed  = job.status === 'failed';

  // Blockers: from progress_json or infer from failed foundation items
  const rawBlockers = (job.progress_json?.blockers || []) as unknown as Blocker[];
  const blockers: Blocker[] = rawBlockers.length > 0
    ? rawBlockers
    : (isBlocked
        ? foundation
            .filter(i => i.status === 'failed' || (i.gate_failures && i.gate_failures.length > 0))
            .map(i => ({
              type: 'foundation_gate_failed',
              doc_type: i.doc_type,
              item_key: i.item_key,
              gate_failures: i.gate_failures || undefined,
              output_doc_id: i.output_doc_id || undefined,
              output_version_id: i.output_version_id || undefined,
            }))
        : []);

  const currentActivity = narrativeCurrentStep(job.progress_json?.current_step || null, items);

  return (
    <div className="space-y-4 mt-3">
      {/* ── NARRATIVE STATUS BANNER ── */}
      <NarrativeBanner
        job={job}
        isBlocked={isBlocked}
        isDone={isDone}
        isFailed={isFailed}
        isPaused={isPaused}
        isRunning={isRunning}
        fDone={fDone}
        fTotal={fTotal}
        fFailed={fFailed}
        dDone={dDone}
        dTotal={dTotal}
        currentActivity={currentActivity}
        onPause={onPause}
        onResume={onResume}
        hasBlockers={blockers.length > 0}
      />

      {/* ── BLOCKER PANEL ── */}
      {isBlocked && blockers.length > 0 && (
        <BlockerPanel blockers={blockers} projectId={projectId} />
      )}

      {/* ── FOUNDATION PROGRESS ── */}
      <PhaseProgressCard
        title="Foundation Convergence"
        subtitle={`${fDone}/${fTotal} approved${fFailed > 0 ? ` · ${fFailed} need fix` : ''}`}
        pct={fPct}
        items={foundation}
        projectId={projectId}
        currentStep={job.progress_json?.current_step || null}
        variant="foundation"
      />

      {/* ── DEV PACK PROGRESS ── */}
      {dTotal > 0 && (
        <DevpackProgressCard
          pct={dPct}
          dDone={dDone}
          dTotal={dTotal}
          dFailed={dFailed}
          devpackItems={devpack}
          isBlocked={isBlocked}
          projectId={projectId}
          currentStep={job.progress_json?.current_step || null}
        />
      )}

      {/* ── RAW LIST (power users) ── */}
      <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            {rawOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Show raw item list
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <RawItemTable items={items} projectId={projectId} />
        </CollapsibleContent>
      </Collapsible>

      {/* ── ERROR DISPLAY ── */}
      {job.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
          {job.error}
        </div>
      )}
      {job.progress_json?.last_error && !job.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
          {job.progress_json.last_error}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   NARRATIVE BANNER
   ══════════════════════════════════════════════════════════════ */

function NarrativeBanner({
  job, isBlocked, isDone, isFailed, isPaused, isRunning,
  fDone, fTotal, fFailed, dDone, dTotal,
  currentActivity, onPause, onResume, hasBlockers,
}: {
  job: DevSeedJob;
  isBlocked: boolean; isDone: boolean; isFailed: boolean;
  isPaused: boolean; isRunning: boolean;
  fDone: number; fTotal: number; fFailed: number;
  dDone: number; dTotal: number;
  currentActivity: string | null;
  onPause: () => void; onResume: () => void;
  hasBlockers: boolean;
}) {
  let icon: React.ReactNode;
  let title: string;
  let subtitle: string;
  let variant: 'default' | 'warning' | 'success' | 'error' = 'default';

  if (isDone) {
    icon = <CheckCircle className="h-5 w-5 text-emerald-500" />;
    title = 'Complete';
    subtitle = `Foundation converged & approved${dTotal > 0 ? `. Dev pack: ${dDone}/${dTotal} complete.` : '.'}`;
    variant = 'success';
  } else if (isFailed) {
    icon = <XCircle className="h-5 w-5 text-destructive" />;
    title = 'Failed';
    subtitle = job.progress_json?.last_error || 'An unrecoverable error occurred.';
    variant = 'error';
  } else if (isBlocked) {
    icon = <ShieldAlert className="h-5 w-5 text-destructive" />;
    title = 'Blocked';
    subtitle = `${fFailed} foundation doc${fFailed !== 1 ? 's' : ''} failed gate — fix required before dev pack can proceed.`;
    variant = 'warning';
  } else if (isPaused) {
    icon = <Pause className="h-5 w-5 text-muted-foreground" />;
    title = 'Paused';
    subtitle = `Foundation: ${fDone}/${fTotal} approved${dTotal > 0 ? ` · Dev Pack: ${dDone}/${dTotal}` : ''}`;
  } else {
    icon = <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    title = 'In Progress';
    const parts: string[] = [`Foundation: ${fDone}/${fTotal} approved`];
    if (dTotal > 0) parts.push(`Dev Pack: ${dDone}/${dTotal}`);
    subtitle = parts.join(' · ');
  }

  const borderColor = variant === 'warning' ? 'border-destructive/30'
    : variant === 'error' ? 'border-destructive/40'
    : variant === 'success' ? 'border-emerald-500/30'
    : 'border-primary/30';

  const bgColor = variant === 'warning' ? 'bg-destructive/5'
    : variant === 'error' ? 'bg-destructive/5'
    : variant === 'success' ? 'bg-emerald-500/5'
    : 'bg-primary/5';

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-3 space-y-1.5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={onPause} className="h-7 text-xs gap-1">
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="outline" size="sm" onClick={onResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {isBlocked && (
            <Button
              variant="outline"
              size="sm"
              onClick={onResume}
              disabled={hasBlockers}
              className="h-7 text-xs gap-1"
              title={hasBlockers ? 'Fix blockers first' : 'Retry foundation gate'}
            >
              <Play className="h-3 w-3" /> Retry
            </Button>
          )}
        </div>
      </div>
      {currentActivity && !isDone && !isBlocked && !isFailed && (
        <p className="text-xs text-primary font-medium pl-7">
          Currently: {currentActivity}
        </p>
      )}
      {job.created_at && (
        <p className="text-[10px] text-muted-foreground pl-7">
          Started {timeAgo(job.created_at)}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   BLOCKER PANEL
   ══════════════════════════════════════════════════════════════ */

function BlockerPanel({ blockers, projectId }: { blockers: Blocker[]; projectId?: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Foundation docs must pass gate before Development Pack can proceed
      </div>
      <div className="space-y-1">
        {blockers.map((b, i) => {
          const link = docLink(projectId, b.output_doc_id, b.output_version_id);
          return (
            <div key={i} className="flex items-center justify-between rounded bg-destructive/10 px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-xs font-medium text-foreground truncate">
                  {labelForDocType(b.doc_type)}
                </span>
                {b.gate_failures && b.gate_failures.length > 0 && (
                  <span className="text-[11px] text-destructive truncate">
                    — {summarizeFailures(b.gate_failures)}
                  </span>
                )}
              </div>
              {link && (
                <a
                  href={link}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0 ml-2"
                >
                  Open to fix <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Open each failing document, resolve the issues, then click <strong>Retry</strong>.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PHASE PROGRESS CARD (Foundation)
   ══════════════════════════════════════════════════════════════ */

function PhaseProgressCard({
  title, subtitle, pct, items, projectId, currentStep, variant,
}: {
  title: string;
  subtitle: string;
  pct: number;
  items: DevSeedJobItem[];
  projectId?: string;
  currentStep: string | null;
  variant: 'foundation' | 'devpack';
}) {
  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 border-b border-border/30">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        </div>
        <Progress value={pct} className="h-1.5 mt-1.5" />
      </div>
      <div className="divide-y divide-border/20">
        {items.map(item => (
          <ItemRow key={item.id} item={item} projectId={projectId} isCurrent={item.item_key === currentStep} />
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DEVPACK PROGRESS CARD (grouped by section)
   ══════════════════════════════════════════════════════════════ */

function DevpackProgressCard({
  pct, dDone, dTotal, dFailed, devpackItems, isBlocked, projectId, currentStep,
}: {
  pct: number; dDone: number; dTotal: number; dFailed: number;
  devpackItems: DevSeedJobItem[];
  isBlocked: boolean;
  projectId?: string;
  currentStep: string | null;
}) {
  const sections = groupDevpackItems(devpackItems);

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <div className="px-3 py-2 bg-muted/30 border-b border-border/30">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Development Pack</p>
          <span className="text-[11px] text-muted-foreground">
            {dDone}/{dTotal} complete{dFailed > 0 ? ` · ${dFailed} failed` : ''}
          </span>
        </div>
        <Progress value={pct} className="h-1.5 mt-1.5" />
      </div>

      {isBlocked ? (
        <div className="px-3 py-4 text-center">
          <Clock className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">Waiting for foundation approval…</p>
        </div>
      ) : (
        <div>
          {sections.map(section => (
            <div key={section.key}>
              {sections.length > 1 && (
                <div className="px-3 py-1 bg-muted/20 border-b border-border/20">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {section.label}
                  </p>
                </div>
              )}
              <div className="divide-y divide-border/20">
                {section.items.map((item: DevSeedJobItem) => (
                  <ItemRow key={item.id} item={item} projectId={projectId} isCurrent={item.item_key === currentStep} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ITEM ROW
   ══════════════════════════════════════════════════════════════ */

function ItemRow({ item, projectId, isCurrent }: { item: DevSeedJobItem; projectId?: string; isCurrent: boolean }) {
  const link = docLink(projectId, item.output_doc_id, item.output_version_id);
  const hLink = historyLink(projectId, item.output_doc_id);
  const label = labelForDocType(item.doc_type, item.episode_index);
  const verb = verbForStatus(item.status);

  return (
    <div className={`flex items-center gap-2 px-3 py-2 text-xs ${isCurrent ? 'bg-primary/5' : ''}`}>
      {/* Status icon */}
      <div className="shrink-0">{STATUS_ICON[item.status] || null}</div>

      {/* Label + verb */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground ml-1.5">· {verb}</span>
        {item.error_detail && item.status === 'failed' && (
          <p className="text-[10px] text-destructive mt-0.5 truncate">{item.error_detail}</p>
        )}
      </div>

      {/* Gate badge */}
      <div className="shrink-0">
        {item.gate_score != null ? (
          <Badge variant={item.gate_score >= 75 ? 'default' : 'secondary'} className="text-[10px] px-1.5">
            CI:{item.gate_score}
          </Badge>
        ) : item.gate_failures && item.gate_failures.length > 0 ? (
          <Badge variant="destructive" className="text-[10px] px-1.5">
            {summarizeFailures(item.gate_failures)}
          </Badge>
        ) : null}
      </div>

      {/* Attempts */}
      {item.attempts > 1 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          ×{item.attempts}
        </span>
      )}

      {/* Action links */}
      <div className="flex items-center gap-1 shrink-0">
        {link && (
          <a href={link} className="text-primary hover:text-primary/80 transition-colors" title="View latest version">
            <Eye className="h-3.5 w-3.5" />
          </a>
        )}
        {hLink && item.output_doc_id && (
          <a href={hLink} className="text-muted-foreground hover:text-foreground transition-colors" title="Version history">
            <History className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RAW ITEM TABLE (power users, collapsible)
   ══════════════════════════════════════════════════════════════ */

function RawItemTable({ items, projectId }: { items: DevSeedJobItem[]; projectId?: string }) {
  return (
    <div className="rounded-md border border-border/40 overflow-hidden">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-muted/50 border-b border-border/30">
            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Item Key</th>
            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Type</th>
            <th className="text-center px-2 py-1 font-medium text-muted-foreground">Ep</th>
            <th className="text-center px-2 py-1 font-medium text-muted-foreground">Phase</th>
            <th className="text-center px-2 py-1 font-medium text-muted-foreground">Status</th>
            <th className="text-center px-2 py-1 font-medium text-muted-foreground">Gate</th>
            <th className="text-center px-2 py-1 font-medium text-muted-foreground">Att.</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-border/20 last:border-0">
              <td className="px-2 py-1 font-mono text-foreground">{item.item_key}</td>
              <td className="px-2 py-1 text-muted-foreground">{item.doc_type}</td>
              <td className="px-2 py-1 text-center text-muted-foreground">{item.episode_index ?? '—'}</td>
              <td className="px-2 py-1 text-center">
                <Badge variant="outline" className="text-[9px] px-1">
                  {derivePhase(item as any)}
                </Badge>
              </td>
              <td className="px-2 py-1 text-center">
                <span className="inline-flex items-center gap-0.5">
                  {STATUS_ICON[item.status]}
                  <span>{item.status}</span>
                </span>
              </td>
              <td className="px-2 py-1 text-center">
                {item.gate_score != null ? `CI:${item.gate_score}` : item.gate_failures?.length ? item.gate_failures[0] : '—'}
              </td>
              <td className="px-2 py-1 text-center">{item.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
