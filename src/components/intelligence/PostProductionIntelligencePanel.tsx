/**
 * Post-Production Intelligence Panel
 * Manages milestones, edit versions with screening score delta, and VFX shots.
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Film, Palette, Clock, CheckCircle2, Plus, Trash2, Check, X, AlertTriangle,
  Clapperboard, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePostMilestones, useEditVersions, useVfxShots } from '@/hooks/usePostProduction';
import type { PostMilestone, EditVersion, VfxShot } from '@/hooks/usePostProduction';

interface Props {
  projectId: string;
}

const MILESTONE_TYPES = [
  { value: 'picture_lock', label: 'Picture Lock' },
  { value: 'sound_mix', label: 'Sound Mix' },
  { value: 'color_grade', label: 'Color Grade' },
  { value: 'vfx_final', label: 'VFX Final' },
  { value: 'music_license', label: 'Music License' },
  { value: 'dcp', label: 'DCP/Master' },
  { value: 'qc_pass', label: 'QC Pass' },
  { value: 'other', label: 'Other' },
];

const MILESTONE_STATUSES = [
  { value: 'pending', label: 'Pending', color: 'text-muted-foreground border-border bg-muted' },
  { value: 'in_progress', label: 'In Progress', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  { value: 'complete', label: 'Complete', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  { value: 'overdue', label: 'Overdue', color: 'text-red-400 border-red-500/30 bg-red-500/10' },
];

const VFX_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'final', label: 'Final' },
];

const VFX_COMPLEXITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'hero', label: 'Hero' },
];

export function PostProductionIntelligencePanel({ projectId }: Props) {
  const { milestones, add: addMilestone, update: updateMilestone, remove: removeMilestone } = usePostMilestones(projectId);
  const { versions, add: addVersion, remove: removeVersion } = useEditVersions(projectId);
  const { shots, add: addShot, update: updateShot, remove: removeShot } = useVfxShots(projectId);

  // ── Milestone state ──
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [msForm, setMsForm] = useState({ milestone_type: 'picture_lock', label: '', due_date: '' });

  // ── Edit version state ──
  const [addingVersion, setAddingVersion] = useState(false);
  const [vForm, setVForm] = useState({ version_label: '', notes: '', screening_score: '' });

  // ── VFX state ──
  const [addingVfx, setAddingVfx] = useState(false);
  const [vfxForm, setVfxForm] = useState({ shot_id: '', vendor: '', complexity: 'medium', due_date: '' });

  // ── Computed stats ──
  const milestoneStats = useMemo(() => {
    const total = milestones.length;
    const complete = milestones.filter(m => m.status === 'complete').length;
    const overdue = milestones.filter(m => {
      if (m.status === 'complete') return false;
      if (!m.due_date) return false;
      return new Date(m.due_date) < new Date();
    }).length;
    return { total, complete, overdue, pct: total > 0 ? Math.round((complete / total) * 100) : 0 };
  }, [milestones]);

  const vfxStats = useMemo(() => {
    const total = shots.length;
    const done = shots.filter(s => s.status === 'final' || s.status === 'approved').length;
    const overdue = shots.filter(s => {
      if (s.status === 'final' || s.status === 'approved') return false;
      if (!s.due_date) return false;
      return new Date(s.due_date) < new Date();
    }).length;
    return { total, done, overdue, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [shots]);

  const versionDeltas = useMemo(() => {
    if (versions.length < 2) return [];
    const sorted = [...versions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return sorted.slice(1).map((v, i) => {
      const prev = sorted[i];
      const delta = (v.screening_score != null && prev.screening_score != null)
        ? v.screening_score - prev.screening_score : null;
      return { ...v, delta };
    }).reverse();
  }, [versions]);

  // ── Handlers ──
  const handleAddMilestone = () => {
    if (!msForm.label.trim()) return;
    addMilestone.mutate({
      milestone_type: msForm.milestone_type,
      label: msForm.label,
      due_date: msForm.due_date || null,
    } as any);
    setMsForm({ milestone_type: 'picture_lock', label: '', due_date: '' });
    setAddingMilestone(false);
  };

  const handleAddVersion = () => {
    if (!vForm.version_label.trim()) return;
    addVersion.mutate({
      version_label: vForm.version_label,
      notes: vForm.notes,
      screening_score: vForm.screening_score ? parseInt(vForm.screening_score) : null,
    } as any);
    setVForm({ version_label: '', notes: '', screening_score: '' });
    setAddingVersion(false);
  };

  const handleAddVfx = () => {
    if (!vfxForm.shot_id.trim()) return;
    addShot.mutate({
      shot_id: vfxForm.shot_id,
      vendor: vfxForm.vendor,
      complexity: vfxForm.complexity,
      due_date: vfxForm.due_date || null,
    } as any);
    setVfxForm({ shot_id: '', vendor: '', complexity: 'medium', due_date: '' });
    setAddingVfx(false);
  };

  return (
    <div className="space-y-4">
      {/* ── Milestones ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-violet-400" />
            <h4 className="font-display font-semibold text-foreground text-sm">Post Milestones</h4>
          </div>
          {milestoneStats.total > 0 && (
            <span className={cn('text-sm font-bold font-display',
              milestoneStats.pct >= 75 ? 'text-emerald-400' : milestoneStats.pct >= 40 ? 'text-amber-400' : 'text-red-400'
            )}>{milestoneStats.pct}%</span>
          )}
        </div>

        {milestoneStats.total > 0 && (
          <>
            <Progress value={milestoneStats.pct} className="h-1.5 mb-2" />
            <div className="flex gap-3 text-xs text-muted-foreground mb-3">
              <span>{milestoneStats.complete}/{milestoneStats.total} complete</span>
              {milestoneStats.overdue > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {milestoneStats.overdue} overdue
                </span>
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5">
          {milestones.map(m => {
            const isOverdue = m.status !== 'complete' && m.due_date && new Date(m.due_date) < new Date();
            const effectiveStatus = isOverdue ? 'overdue' : m.status;
            const statusInfo = MILESTONE_STATUSES.find(s => s.value === effectiveStatus) || MILESTONE_STATUSES[0];
            const typeInfo = MILESTONE_TYPES.find(t => t.value === m.milestone_type);
            return (
              <div key={m.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground truncate">{m.label}</span>
                    <Badge className="text-[9px] px-1.5 py-0 border bg-muted text-muted-foreground border-border">
                      {typeInfo?.label || m.milestone_type}
                    </Badge>
                  </div>
                  {m.due_date && (
                    <span className={cn('text-[10px]', isOverdue ? 'text-red-400' : 'text-muted-foreground')}>
                      Due: {new Date(m.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Select value={effectiveStatus} onValueChange={v => {
                  const updates: any = { id: m.id, status: v };
                  if (v === 'complete') updates.completed_date = new Date().toISOString().split('T')[0];
                  updateMilestone.mutate(updates);
                }}>
                  <SelectTrigger className="h-6 w-28 text-[10px] border-0 bg-transparent">
                    <Badge className={cn('text-[10px] px-1.5 py-0 border', statusInfo.color)}>{statusInfo.label}</Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {MILESTONE_STATUSES.filter(s => s.value !== 'overdue').map(s => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeMilestone.mutate(m.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        {addingMilestone ? (
          <div className="space-y-2 mt-2 bg-muted/20 rounded-lg px-3 py-2">
            <Input placeholder="Milestone label" value={msForm.label}
              onChange={e => setMsForm(f => ({ ...f, label: e.target.value }))} className="h-8 text-sm" />
            <div className="flex gap-2">
              <Select value={msForm.milestone_type} onValueChange={v => setMsForm(f => ({ ...f, milestone_type: v }))}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MILESTONE_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={msForm.due_date}
                onChange={e => setMsForm(f => ({ ...f, due_date: e.target.value }))} className="h-8 text-xs flex-1" />
            </div>
            <div className="flex gap-2">
              <Button size="icon" className="h-7 w-7" onClick={handleAddMilestone} disabled={!msForm.label.trim()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAddingMilestone(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingMilestone(true)} className="w-full mt-2">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Milestone
          </Button>
        )}
      </motion.div>

      {/* ── Edit Versions ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Palette className="h-4 w-4 text-violet-400" />
          <h4 className="font-display font-semibold text-foreground text-sm">Edit Version Tracker</h4>
        </div>

        <div className="space-y-1.5">
          {versions.map((v, i) => {
            const delta = versionDeltas.find(d => d.id === v.id)?.delta;
            return (
              <div key={v.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{v.version_label}</span>
                    {v.screening_score != null && (
                      <Badge className="text-[9px] px-1.5 py-0 border bg-muted text-muted-foreground border-border">
                        Score: {v.screening_score}
                      </Badge>
                    )}
                    {delta != null && delta !== 0 && (
                      <span className={cn('text-[10px] flex items-center gap-0.5 font-medium',
                        delta > 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    )}
                  </div>
                  {v.notes && <p className="text-[10px] text-muted-foreground truncate">{v.notes}</p>}
                  <span className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeVersion.mutate(v.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        {addingVersion ? (
          <div className="space-y-2 mt-2 bg-muted/20 rounded-lg px-3 py-2">
            <Input placeholder="Version label (e.g. Director's Cut v3)" value={vForm.version_label}
              onChange={e => setVForm(f => ({ ...f, version_label: e.target.value }))} className="h-8 text-sm" />
            <div className="flex gap-2">
              <Input placeholder="Notes" value={vForm.notes}
                onChange={e => setVForm(f => ({ ...f, notes: e.target.value }))} className="h-8 text-sm flex-1" />
              <Input type="number" placeholder="Score (0-100)" value={vForm.screening_score} min={0} max={100}
                onChange={e => setVForm(f => ({ ...f, screening_score: e.target.value }))} className="h-8 text-xs w-28" />
            </div>
            <div className="flex gap-2">
              <Button size="icon" className="h-7 w-7" onClick={handleAddVersion} disabled={!vForm.version_label.trim()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAddingVersion(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingVersion(true)} className="w-full mt-2">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Log Edit Version
          </Button>
        )}
      </motion.div>

      {/* ── VFX Shots ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-amber-400" />
            <h4 className="font-display font-semibold text-foreground text-sm">VFX Shot Tracker</h4>
          </div>
          {vfxStats.total > 0 && (
            <span className={cn('text-sm font-bold font-display',
              vfxStats.pct >= 75 ? 'text-emerald-400' : vfxStats.pct >= 40 ? 'text-amber-400' : 'text-red-400'
            )}>{vfxStats.pct}%</span>
          )}
        </div>

        {vfxStats.total > 0 && (
          <>
            <Progress value={vfxStats.pct} className="h-1.5 mb-2" />
            <div className="flex gap-3 text-xs text-muted-foreground mb-3">
              <span>{vfxStats.done}/{vfxStats.total} complete</span>
              {vfxStats.overdue > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {vfxStats.overdue} overdue
                </span>
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5">
          {shots.map(s => {
            const isOverdue = !['final', 'approved'].includes(s.status) && s.due_date && new Date(s.due_date) < new Date();
            return (
              <div key={s.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{s.shot_id}</span>
                    <Badge className={cn('text-[9px] px-1.5 py-0 border',
                      s.complexity === 'hero' ? 'text-violet-400 border-violet-500/30 bg-violet-500/10' :
                      s.complexity === 'high' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                      'text-muted-foreground border-border bg-muted'
                    )}>{s.complexity}</Badge>
                    {s.vendor && <span className="text-[10px] text-muted-foreground">{s.vendor}</span>}
                  </div>
                  {s.due_date && (
                    <span className={cn('text-[10px]', isOverdue ? 'text-red-400' : 'text-muted-foreground')}>
                      Due: {new Date(s.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Select value={s.status} onValueChange={v => updateShot.mutate({ id: s.id, status: v })}>
                  <SelectTrigger className="h-6 w-24 text-[10px] border-0 bg-transparent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VFX_STATUSES.map(st => <SelectItem key={st.value} value={st.value} className="text-xs">{st.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeShot.mutate(s.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        {addingVfx ? (
          <div className="space-y-2 mt-2 bg-muted/20 rounded-lg px-3 py-2">
            <div className="flex gap-2">
              <Input placeholder="Shot ID (e.g. VFX_042)" value={vfxForm.shot_id}
                onChange={e => setVfxForm(f => ({ ...f, shot_id: e.target.value }))} className="h-8 text-sm flex-1" />
              <Input placeholder="Vendor" value={vfxForm.vendor}
                onChange={e => setVfxForm(f => ({ ...f, vendor: e.target.value }))} className="h-8 text-sm flex-1" />
            </div>
            <div className="flex gap-2">
              <Select value={vfxForm.complexity} onValueChange={v => setVfxForm(f => ({ ...f, complexity: v }))}>
                <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VFX_COMPLEXITIES.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={vfxForm.due_date}
                onChange={e => setVfxForm(f => ({ ...f, due_date: e.target.value }))} className="h-8 text-xs flex-1" />
            </div>
            <div className="flex gap-2">
              <Button size="icon" className="h-7 w-7" onClick={handleAddVfx} disabled={!vfxForm.shot_id.trim()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAddingVfx(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingVfx(true)} className="w-full mt-2">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add VFX Shot
          </Button>
        )}
      </motion.div>
    </div>
  );
}
