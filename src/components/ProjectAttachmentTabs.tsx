import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, Handshake, FileText, DollarSign, Plus, Trash2, X, Check, Clapperboard, Loader2, CalendarDays, Sparkles, HelpCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type DisambiguationCandidate } from '@/hooks/usePersonResearch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useProjectCast,
  useProjectPartners,
  useProjectScripts,
  useProjectFinance,
  useProjectHODs,
  type ProjectCastMember,
  type ProjectPartner,
  type ProjectScript,
  type ProjectFinanceScenario,
  type ProjectHOD,
} from '@/hooks/useProjectAttachments';
import { useScriptCharacters } from '@/hooks/useScriptCharacters';
import { usePersonResearch } from '@/hooks/usePersonResearch';
import { PersonAssessmentCard } from '@/components/PersonAssessmentCard';
import { ScheduleTab } from '@/components/ScheduleTab';

// ---- Status badge styles ----
const STATUS_STYLES: Record<string, string> = {
  wishlist: 'bg-muted text-muted-foreground border-border',
  approached: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  interested: 'bg-primary/15 text-primary border-primary/30',
  attached: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  identified: 'bg-muted text-muted-foreground border-border',
  'in-discussion': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'in-talks': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  current: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  archived: 'bg-muted text-muted-foreground border-border',
  high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const REPUTATION_STYLES: Record<string, string> = {
  emerging: 'bg-muted text-muted-foreground border-border',
  established: 'bg-primary/15 text-primary border-primary/30',
  acclaimed: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  marquee: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const DEPARTMENTS = [
  'Writer',
  'Director',
  'Director of Photography',
  'Producer',
  'Executive Producer',
  'Line Producer',
  'Editor',
  'Composer',
  'Production Designer',
  'Costume Designer',
  'VFX Supervisor',
  'Sound Designer',
  'Casting Director',
  'Stunt Coordinator',
  'Other',
];

export interface ProjectContext {
  title?: string;
  format?: string;
  budget_range?: string;
  genres?: string[];
}

// ---- Cast Tab ----
function CastTab({ projectId, projectContext }: { projectId: string; projectContext?: ProjectContext }) {
  const { cast, addCast, deleteCast, updateCast } = useProjectCast(projectId);
  const { data: scriptCharacters = [], isLoading: charsLoading } = useScriptCharacters(projectId);
  const { research, loading, assessments, clearAssessment, candidates, confirmCandidate, clearDisambiguation } = usePersonResearch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ role_name: '', actor_name: '', status: 'wishlist' });
  const [customRole, setCustomRole] = useState(false);

  // Filter out characters already cast
  const availableCharacters = useMemo(() => {
    const usedRoles = new Set(cast.map(c => c.role_name.toUpperCase()));
    return scriptCharacters.filter(ch => !usedRoles.has(ch.name.toUpperCase()));
  }, [scriptCharacters, cast]);

  const handleAdd = () => {
    if (!form.actor_name.trim()) return;
    addCast.mutate(form);
    // Trigger research
    research(form.actor_name, 'cast', projectContext);
    setForm({ role_name: '', actor_name: '', status: 'wishlist' });
    setCustomRole(false);
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {cast.map(c => (
        <div key={c.id}>
          <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{c.actor_name}</span>
                {c.role_name && <span className="text-xs text-muted-foreground">as {c.role_name}</span>}
              </div>
              {c.territory_tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {c.territory_tags.map(t => (
                    <span key={t} className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!assessments[c.actor_name] && loading !== c.actor_name && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={() => research(c.actor_name, 'cast', projectContext)}
                  title="Assess market value"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
              )}
              {loading === c.actor_name && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              )}
            </div>
            <Select value={c.status} onValueChange={v => updateCast.mutate({ id: c.id, status: v })}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wishlist">Wishlist</SelectItem>
                <SelectItem value="approached">Approached</SelectItem>
                <SelectItem value="interested">Interested</SelectItem>
                <SelectItem value="attached">Attached</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteCast.mutate(c.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {assessments[c.actor_name] && (
            <PersonAssessmentCard assessment={assessments[c.actor_name]} onDismiss={() => clearAssessment(c.actor_name)} />
          )}
        </div>
      ))}

      {/* Disambiguation Dialog */}
      <DisambiguationDialog
        candidates={candidates}
        onSelect={confirmCandidate}
        onClose={clearDisambiguation}
      />

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Input placeholder="Actor name" value={form.actor_name} onChange={e => setForm(f => ({ ...f, actor_name: e.target.value }))} className="h-8 text-sm flex-1" />
          </div>
          <div className="flex items-center gap-2">
            {!customRole && scriptCharacters.length > 0 ? (
              <Select
                value={form.role_name || undefined}
                onValueChange={v => {
                  if (v === '__custom__') {
                    setCustomRole(true);
                    setForm(f => ({ ...f, role_name: '' }));
                  } else {
                    setForm(f => ({ ...f, role_name: v }));
                  }
                }}
              >
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue placeholder={charsLoading ? "Scanning script…" : "Select character role"} />
                </SelectTrigger>
                <SelectContent>
                  {charsLoading && (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Scanning script…
                    </div>
                  )}
                  {availableCharacters.map(ch => (
                    <SelectItem key={ch.name} value={ch.name}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{ch.name}</span>
                          {ch.scene_count != null && ch.scene_count > 0 && (
                            <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                              {ch.scene_count} scene{ch.scene_count !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {ch.description && <span className="text-[10px] text-muted-foreground">{ch.description}</span>}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">
                    <span className="text-primary">+ Custom character name</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-1 flex-1">
                <Input
                  placeholder="Character / role name"
                  value={form.role_name}
                  onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))}
                  className="h-8 text-sm flex-1"
                />
                {scriptCharacters.length > 0 && customRole && (
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 text-muted-foreground" onClick={() => setCustomRole(false)}>
                    Script list
                  </Button>
                )}
              </div>
            )}
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.actor_name.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setAdding(false); setCustomRole(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {cast.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Cast attachments affect foreign value and finance pathways.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Cast
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Partners Tab ----
function PartnersTab({ projectId }: { projectId: string }) {
  const { partners, addPartner, deletePartner, updatePartner } = useProjectPartners(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ partner_name: '', partner_type: 'co-producer', territory: '' });

  const handleAdd = () => {
    if (!form.partner_name.trim()) return;
    addPartner.mutate(form);
    setForm({ partner_name: '', partner_type: 'co-producer', territory: '' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {partners.map(p => (
        <div key={p.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{p.partner_name}</span>
              <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{p.partner_type}</span>
            </div>
            {p.territory && <span className="text-xs text-muted-foreground">{p.territory}</span>}
          </div>
          <Select value={p.status} onValueChange={v => updatePartner.mutate({ id: p.id, status: v })}>
            <SelectTrigger className="w-28 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="identified">Identified</SelectItem>
              <SelectItem value="approached">Approached</SelectItem>
              <SelectItem value="in-discussion">In Discussion</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deletePartner.mutate(p.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Partner name" value={form.partner_name} onChange={e => setForm(f => ({ ...f, partner_name: e.target.value }))} className="h-8 text-sm flex-1" />
          <Select value={form.partner_type} onValueChange={v => setForm(f => ({ ...f, partner_type: v }))}>
            <SelectTrigger className="w-28 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="co-producer">Co-Producer</SelectItem>
              <SelectItem value="sales-agent">Sales Agent</SelectItem>
              <SelectItem value="distributor">Distributor</SelectItem>
              <SelectItem value="financier">Financier</SelectItem>
              <SelectItem value="broadcaster">Broadcaster</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Territory" value={form.territory} onChange={e => setForm(f => ({ ...f, territory: e.target.value }))} className="h-8 text-sm w-24" />
          <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.partner_name.trim()}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {partners.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Sales agents and co-producers unlock pre-sales and territory value.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Partner
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Scripts Tab ----
function ScriptsTab({ projectId }: { projectId: string }) {
  const { scripts, addScript, deleteScript } = useProjectScripts(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ version_label: '', notes: '' });

  const handleAdd = () => {
    if (!form.version_label.trim()) return;
    addScript.mutate({ version_label: form.version_label, status: 'current', notes: form.notes });
    setForm({ version_label: '', notes: '' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {scripts.map(s => (
        <div key={s.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{s.version_label}</span>
              <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_STYLES[s.status] || ''}`}>
                {s.status}
              </Badge>
            </div>
            {s.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.notes}</p>}
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {new Date(s.created_at).toLocaleDateString()}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteScript.mutate(s.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Version label (e.g. Draft 3)" value={form.version_label} onChange={e => setForm(f => ({ ...f, version_label: e.target.value }))} className="h-8 text-sm flex-1" />
          <Input placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="h-8 text-sm flex-1" />
          <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.version_label.trim()}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Script Version
        </Button>
      )}
    </div>
  );
}

// ---- Finance Scenarios Tab ----
function FinanceTab({ projectId }: { projectId: string }) {
  const { scenarios, addScenario, deleteScenario, updateScenario } = useProjectFinance(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ scenario_name: '', total_budget: '', notes: '' });

  const handleAdd = () => {
    if (!form.scenario_name.trim()) return;
    addScenario.mutate(form);
    setForm({ scenario_name: '', total_budget: '', notes: '' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {scenarios.map(s => (
        <div key={s.id} className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{s.scenario_name}</span>
              <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_STYLES[s.confidence] || ''}`}>
                {s.confidence}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteScenario.mutate(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {s.total_budget && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {s.total_budget && <div><span className="text-muted-foreground">Budget:</span> <span className="text-foreground">{s.total_budget}</span></div>}
              {s.incentive_amount && <div><span className="text-muted-foreground">Incentives:</span> <span className="text-foreground">{s.incentive_amount}</span></div>}
              {s.presales_amount && <div><span className="text-muted-foreground">Pre-sales:</span> <span className="text-foreground">{s.presales_amount}</span></div>}
              {s.equity_amount && <div><span className="text-muted-foreground">Equity:</span> <span className="text-foreground">{s.equity_amount}</span></div>}
              {s.gap_amount && <div><span className="text-muted-foreground">Gap:</span> <span className="text-foreground">{s.gap_amount}</span></div>}
            </div>
          )}
          {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Scenario name" value={form.scenario_name} onChange={e => setForm(f => ({ ...f, scenario_name: e.target.value }))} className="h-8 text-sm flex-1" />
          <Input placeholder="Total budget" value={form.total_budget} onChange={e => setForm(f => ({ ...f, total_budget: e.target.value }))} className="h-8 text-sm w-28" />
          <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.scenario_name.trim()}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Model your capital stack to identify financing gaps early.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Finance Scenario
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- HODs Tab ----
function HODsTab({ projectId, projectContext }: { projectId: string; projectContext?: ProjectContext }) {
  const { hods, addHOD, deleteHOD, updateHOD } = useProjectHODs(projectId);
  const { research, loading, assessments, clearAssessment, candidates, confirmCandidate, clearDisambiguation } = usePersonResearch();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ department: 'Director', person_name: '', known_for: '', reputation_tier: 'emerging' });

  const handleAdd = () => {
    if (!form.person_name.trim()) return;
    addHOD.mutate(form);
    // Trigger research
    research(form.person_name, 'hod', projectContext, form.department, form.known_for);
    setForm({ department: 'Director', person_name: '', known_for: '', reputation_tier: 'emerging' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {hods.map(h => (
        <div key={h.id}>
          <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{h.person_name}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{h.department}</span>
                  <Badge className={`text-[10px] px-1.5 py-0 border ${REPUTATION_STYLES[h.reputation_tier] || ''}`}>
                    {h.reputation_tier}
                  </Badge>
                </div>
                {h.known_for && <p className="text-xs text-muted-foreground mt-0.5 truncate">{h.known_for}</p>}
              </div>
              <div className="flex items-center gap-1">
                {!assessments[h.person_name] && loading !== h.person_name && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={() => research(h.person_name, 'hod', projectContext, h.department, h.known_for)}
                    title="Assess market value"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                )}
                {loading === h.person_name && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </div>
              <Select value={h.status} onValueChange={v => updateHOD.mutate({ id: h.id, status: v })}>
                <SelectTrigger className="w-28 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wishlist">Wishlist</SelectItem>
                  <SelectItem value="in-talks">In Talks</SelectItem>
                  <SelectItem value="attached">Attached</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteHOD.mutate(h.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {assessments[h.person_name] && (
            <PersonAssessmentCard assessment={assessments[h.person_name]} onDismiss={() => clearAssessment(h.person_name)} />
          )}
        </div>
      ))}

      {/* Disambiguation Dialog */}
      <DisambiguationDialog
        candidates={candidates}
        onSelect={confirmCandidate}
        onClose={clearDisambiguation}
      />

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Name" value={form.person_name} onChange={e => setForm(f => ({ ...f, person_name: e.target.value }))} className="h-8 text-sm flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Known for (e.g. Dune, The Bear)" value={form.known_for} onChange={e => setForm(f => ({ ...f, known_for: e.target.value }))} className="h-8 text-sm flex-1" />
            <Select value={form.reputation_tier} onValueChange={v => setForm(f => ({ ...f, reputation_tier: v }))}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="emerging">Emerging</SelectItem>
                <SelectItem value="established">Established</SelectItem>
                <SelectItem value="acclaimed">Acclaimed</SelectItem>
                <SelectItem value="marquee">Marquee</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.person_name.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {hods.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">A director or key HOD attachment significantly strengthens your package.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Head of Department
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Disambiguation Dialog ----
function DisambiguationDialog({
  candidates,
  onSelect,
  onClose,
}: {
  candidates: DisambiguationCandidate[] | null;
  onSelect: (c: DisambiguationCandidate) => void;
  onClose: () => void;
}) {
  if (!candidates || candidates.length <= 1) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <HelpCircle className="h-4.5 w-4.5 text-primary" />
            Multiple people found
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">Which person did you mean?</p>
        <div className="space-y-2">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => onSelect(c)}
              className="w-full text-left border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <p className="text-sm font-semibold text-foreground">{c.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.descriptor}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Known for: <span className="text-foreground">{c.known_for}</span>
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main Component ----
interface Props {
  projectId: string;
  projectContext?: ProjectContext;
}

export function ProjectAttachmentTabs({ projectId, projectContext }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
    >
      <Tabs defaultValue="cast" className="space-y-4">
        <TabsList className="bg-muted/50 w-full grid grid-cols-6">
          <TabsTrigger value="cast" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Cast
          </TabsTrigger>
          <TabsTrigger value="hods" className="gap-1.5 text-xs">
            <Clapperboard className="h-3.5 w-3.5" /> HODs
          </TabsTrigger>
          <TabsTrigger value="partners" className="gap-1.5 text-xs">
            <Handshake className="h-3.5 w-3.5" /> Partners
          </TabsTrigger>
          <TabsTrigger value="scripts" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> Scripts
          </TabsTrigger>
          <TabsTrigger value="finance" className="gap-1.5 text-xs">
            <DollarSign className="h-3.5 w-3.5" /> Finance
          </TabsTrigger>
          <TabsTrigger value="schedule" className="gap-1.5 text-xs">
            <CalendarDays className="h-3.5 w-3.5" /> Schedule
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cast">
          <CastTab projectId={projectId} projectContext={projectContext} />
        </TabsContent>
        <TabsContent value="hods">
          <HODsTab projectId={projectId} projectContext={projectContext} />
        </TabsContent>
        <TabsContent value="partners">
          <PartnersTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="scripts">
          <ScriptsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="finance">
          <FinanceTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
