import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Handshake, FileText, DollarSign, Plus, Trash2, X, Check, Clapperboard, Loader2, CalendarDays, Sparkles, HelpCircle, RefreshCw, ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';
import { InfoTooltip } from '@/components/InfoTooltip';
import { SmartPackaging } from '@/components/SmartPackaging';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type DisambiguationCandidate } from '@/hooks/usePersonResearch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { PersonNameLink } from '@/components/PersonNameLink';
import { useProjectDeals, type DealCategory } from '@/hooks/useDeals';

// ---- Status badge styles ----
const STATUS_STYLES: Record<string, string> = {
  wishlist: 'bg-muted text-muted-foreground border-border',
  approached: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  interested: 'bg-primary/15 text-primary border-primary/30',
  'in-talks': 'bg-primary/15 text-primary border-primary/30',
  'offer-out': 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  attached: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  passed: 'bg-red-500/15 text-red-400 border-red-500/30',
  identified: 'bg-muted text-muted-foreground border-border',
  'in-discussion': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
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
  const [form, setForm] = useState({ role_name: '', actor_name: '', status: 'wishlist', territory_tags: '' });
  const [customRole, setCustomRole] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');

  // Filter out characters already cast
  const availableCharacters = useMemo(() => {
    const usedRoles = new Set(cast.map(c => c.role_name.toUpperCase()));
    return scriptCharacters.filter(ch => !usedRoles.has(ch.name.toUpperCase()));
  }, [scriptCharacters, cast]);

  const handleAdd = () => {
    if (!form.actor_name.trim()) return;
    const territories = form.territory_tags.split(',').map(t => t.trim()).filter(Boolean);
    addCast.mutate({ role_name: form.role_name, actor_name: form.actor_name, status: form.status, territory_tags: territories });
    research(form.actor_name, 'cast', projectContext);
    setForm({ role_name: '', actor_name: '', status: 'wishlist', territory_tags: '' });
    setCustomRole(false);
    setAdding(false);
  };

  const handleSaveNote = (c: ProjectCastMember) => {
    if (!noteInput.trim()) return;
    const timestamp = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const existingNotes = c.notes ? c.notes.trim() : '';
    const newEntry = `[${timestamp}] ${noteInput.trim()}`;
    const updatedNotes = existingNotes ? `${newEntry}\n${existingNotes}` : newEntry;
    updateCast.mutate({ id: c.id, notes: updatedNotes });
    setNoteInput('');
  };

  return (
    <div className="space-y-3">
      {cast.map(c => {
        const isExpanded = expandedNotes === c.id;
        const noteLines = c.notes ? c.notes.split('\n').filter(Boolean) : [];
        return (
        <div key={c.id}>
          <div className="bg-muted/30 rounded-lg px-3 py-3 space-y-1.5">
            <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <PersonNameLink
                  personName={c.actor_name}
                  reason={c.role_name || 'Cast'}
                  projectContext={projectContext}
                  size="md"
                  onNameCorrected={(name) => updateCast.mutate({ id: c.id, actor_name: name })}
                  contactFields={{ agent_name: c.agent_name, manager_name: c.manager_name, agency: c.agency, contact_phone: c.contact_phone, contact_email: c.contact_email }}
                  onContactSave={(fields) => updateCast.mutate({ id: c.id, ...fields })}
                  onExternalIds={(ids) => updateCast.mutate({ id: c.id, imdb_id: ids.imdb_id || '', tmdb_id: ids.tmdb_id || '' })}
                />
                {c.role_name && <span className="text-xs text-muted-foreground">as <span className="font-medium text-foreground/80">{c.role_name}</span></span>}
              </div>
              <div className="flex gap-1 mt-1.5 ml-12 flex-wrap">
                {c.agency && (
                  <span className="text-[10px] text-primary/80 bg-primary/10 rounded px-1.5 py-0.5">{c.agency}</span>
                )}
                {c.agent_name && !c.agency && (
                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">Agent: {c.agent_name}</span>
                )}
                {c.territory_tags.map(t => (
                  <span key={t} className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{t}</span>
                ))}
              </div>
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
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${noteLines.length > 0 ? 'text-primary' : 'text-muted-foreground'} hover:text-primary`}
                onClick={() => setExpandedNotes(isExpanded ? null : c.id)}
                title="Notes & activity"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {noteLines.length > 0 && <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-primary text-primary-foreground rounded-full h-3.5 w-3.5 flex items-center justify-center">{noteLines.length}</span>}
              </Button>
            </div>
            <Select value={c.status} onValueChange={v => updateCast.mutate({ id: c.id, status: v })}>
              <SelectTrigger className={`w-28 h-7 text-xs border ${STATUS_STYLES[c.status] || ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wishlist">Wishlist</SelectItem>
                <SelectItem value="approached">Approached</SelectItem>
                <SelectItem value="in-talks">In Talks</SelectItem>
                <SelectItem value="offer-out">Offer Out</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={(c as any).market_value_tier || 'unknown'} onValueChange={v => updateCast.mutate({ id: c.id, market_value_tier: v } as any)}>
              <SelectTrigger className="w-24 h-7 text-xs border border-border/50">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marquee">Marquee</SelectItem>
                <SelectItem value="a-list">A-List</SelectItem>
                <SelectItem value="b-list">B-List</SelectItem>
                <SelectItem value="emerging">Emerging</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteCast.mutate(c.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            </div>

            {/* Expandable notes section */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden ml-12"
                >
                  <div className="pt-2 border-t border-border/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Add a note (e.g. 'Spoke to agent, avail confirmed for Q3')"
                        value={expandedNotes === c.id ? noteInput : ''}
                        onChange={e => setNoteInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveNote(c)}
                        className="h-7 text-xs flex-1"
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={() => handleSaveNote(c)} disabled={!noteInput.trim()}>
                        <Send className="h-3 w-3" />
                      </Button>
                    </div>
                    {noteLines.length > 0 && (
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {noteLines.map((line, i) => (
                          <p key={i} className="text-xs text-muted-foreground leading-relaxed">{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {assessments[c.actor_name] && (
            <PersonAssessmentCard assessment={assessments[c.actor_name]} onDismiss={() => clearAssessment(c.actor_name)} />
          )}
        </div>
        );
      })}

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
          </div>
          {/* Status & Territory row */}
          <div className="flex items-center gap-2">
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wishlist">Wishlist</SelectItem>
                <SelectItem value="approached">Approached</SelectItem>
                <SelectItem value="in-talks">In Talks</SelectItem>
                <SelectItem value="offer-out">Offer Out</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Territories (e.g. UK, US)"
              value={form.territory_tags}
              onChange={e => setForm(f => ({ ...f, territory_tags: e.target.value }))}
              className="h-8 text-sm flex-1"
            />
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

// ---- Finance Scenarios Tab (exported for use in Finance section) ----

export const FINANCE_FIELD_HINTS: Record<string, { label: string; placeholder: string; tip: string }> = {
  total_budget: { label: 'Total Budget', placeholder: 'e.g. $2.5M', tip: 'The all-in production budget you\'re targeting. This becomes the benchmark everything else is measured against.' },
  equity_amount: { label: 'Equity', placeholder: 'e.g. $500K', tip: 'Private investment — producer equity, gap equity, or mezzanine finance. Usually the riskiest money in, so it\'s the hardest to close.' },
  presales_amount: { label: 'Pre-Sales', placeholder: 'e.g. $800K', tip: 'Revenue from territory sales committed before production. This is how distributors and sales agents de-risk the project.' },
  incentive_amount: { label: 'Incentives', placeholder: 'e.g. $400K', tip: 'Tax credits, rebates, or soft money from governments. Often the most reliable source but requires qualifying spend in specific jurisdictions.' },
  gap_amount: { label: 'Gap / Bridge', placeholder: 'e.g. $200K', tip: 'Financing against unsold territories — a bank lends against projected sales. Requires a sales agent with a strong track record.' },
  other_sources: { label: 'Other Sources', placeholder: 'e.g. $100K', tip: 'Broadcaster pre-buys, brand partnerships, crowdfunding, deferrals, or any source that doesn\'t fit the categories above.' },
};

const CONFIDENCE_OPTIONS = [
  { value: 'high', label: 'High', desc: 'Letters of intent or signed deals in hand' },
  { value: 'medium', label: 'Medium', desc: 'Verbal interest or advanced discussions' },
  { value: 'low', label: 'Low', desc: 'Early stage — exploratory or aspirational' },
];

export function FinanceTab({ projectId }: { projectId: string }) {
  const { scenarios, addScenario, deleteScenario, updateScenario } = useProjectFinance(projectId);
  const { deals, categoryTotals } = useProjectDeals(projectId);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    scenario_name: '',
    total_budget: '',
    equity_amount: '',
    presales_amount: '',
    incentive_amount: '',
    gap_amount: '',
    other_sources: '',
    confidence: 'medium',
    notes: '',
  });

  const resetForm = () => setForm({
    scenario_name: '', total_budget: '', equity_amount: '', presales_amount: '',
    incentive_amount: '', gap_amount: '', other_sources: '', confidence: 'medium', notes: '',
  });

  const handleAdd = () => {
    if (!form.scenario_name.trim()) return;
    addScenario.mutate(form);
    resetForm();
    setAdding(false);
  };

  const hasClosedDeals = Object.values(categoryTotals as Record<string, number>).some(v => v > 0);

  const handleSyncFromDeals = (scenarioId: string) => {
    const fmtAmt = (v: number) => v > 0 ? v.toString() : '';
    const salesTotal = (categoryTotals.sales || 0) + (categoryTotals['soft-money'] || 0);
    updateScenario.mutate({
      id: scenarioId,
      presales_amount: fmtAmt(salesTotal),
      equity_amount: fmtAmt(categoryTotals.equity || 0),
      incentive_amount: fmtAmt(categoryTotals.incentive || 0),
      gap_amount: fmtAmt(categoryTotals.gap || 0),
      other_sources: fmtAmt(categoryTotals.other || 0),
    });
  };

  const parseAmt = (v: string) => {
    if (!v) return 0;
    return parseFloat(v.replace(/[^0-9.]/g, '')) || 0;
  };

  const scenarioSummary = (s: ProjectFinanceScenario) => {
    const total = parseAmt(s.total_budget);
    const funded = parseAmt(s.equity_amount) + parseAmt(s.presales_amount) + parseAmt(s.incentive_amount) + parseAmt(s.gap_amount) + parseAmt(s.other_sources);
    const pct = total > 0 ? Math.round((funded / total) * 100) : 0;
    return { total, funded, pct, gap: total - funded };
  };

  const fmtCurrency = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div className="space-y-3">
      {/* Existing scenarios */}
      {scenarios.map(s => {
        const { total, funded, pct, gap } = scenarioSummary(s);
        const isExpanded = expandedId === s.id;
        return (
          <div key={s.id} className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-2 text-left flex-1 min-w-0"
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
              >
                <span className="text-sm font-medium text-foreground truncate">{s.scenario_name}</span>
                <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_STYLES[s.confidence] || ''}`}>
                  {s.confidence}
                </Badge>
                {total > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-auto mr-2">
                    {pct}% funded
                  </span>
                )}
              </button>
              {hasClosedDeals && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={() => handleSyncFromDeals(s.id)}
                  title="Sync amounts from closed deals"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteScenario.mutate(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Mini funding bar */}
            {total > 0 && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    background: pct >= 90 ? 'hsl(var(--primary))' : pct >= 50 ? 'hsl(35, 90%, 55%)' : 'hsl(0, 70%, 55%)',
                  }}
                />
              </div>
            )}

            {/* Summary row */}
            {total > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>Budget: <span className="text-foreground font-medium">{fmtCurrency(total)}</span></span>
                <span>Funded: <span className="text-foreground font-medium">{fmtCurrency(funded)}</span></span>
                {gap > 0 && <span className="text-amber-400">Gap: {fmtCurrency(gap)}</span>}
              </div>
            )}

            {/* Expanded detail */}
            {isExpanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-1 border-t border-border/50">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(FINANCE_FIELD_HINTS).map(([key, { label }]) => {
                    const val = s[key as keyof ProjectFinanceScenario] as string;
                    if (!val && key !== 'total_budget') return null;
                    return (
                      <div key={key}>
                        <span className="text-muted-foreground">{label}:</span>{' '}
                        <span className="text-foreground">{val || '—'}</span>
                      </div>
                    );
                  })}
                </div>
                {s.notes && <p className="text-xs text-muted-foreground italic">{s.notes}</p>}
              </motion.div>
            )}
          </div>
        );
      })}

      {/* Add form */}
      {adding ? (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 bg-muted/20 rounded-lg px-4 py-3 border border-border/50">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Name this scenario (e.g. "Base Case", "Without Tax Credit", "Optimistic Pre-Sales") and fill in the funding sources you've identified. Leave blank what you don't know yet — you can update later.
          </p>

          <Input
            placeholder="Scenario name (e.g. Base Case)"
            value={form.scenario_name}
            onChange={e => setForm(f => ({ ...f, scenario_name: e.target.value }))}
            className="h-8 text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FINANCE_FIELD_HINTS).map(([key, { label, placeholder, tip }]) => (
              <div key={key} className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] text-muted-foreground font-medium">{label}</label>
                  <InfoTooltip text={tip} />
                </div>
                <Input
                  placeholder={placeholder}
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <label className="text-[11px] text-muted-foreground font-medium">Confidence</label>
              <InfoTooltip text="How solid are these numbers? High = signed deals. Medium = verbal interest. Low = aspirational targets." />
            </div>
            <Select value={form.confidence} onValueChange={v => setForm(f => ({ ...f, confidence: v }))}>
              <SelectTrigger className="h-7 text-xs w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIDENCE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    <span>{o.label}</span>
                    <span className="text-muted-foreground ml-1.5">— {o.desc}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            placeholder="Notes (optional — e.g. 'Assumes Ireland shoot for Section 481')"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="h-7 text-xs"
          />

          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { resetForm(); setAdding(false); }}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!form.scenario_name.trim()}>
              <Check className="h-3.5 w-3.5 mr-1" /> Save Scenario
            </Button>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-2">
          {scenarios.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <DollarSign className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Capital Stack Modelling</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                A finance scenario maps where your money is coming from — equity, pre-sales, incentives, gap, and other sources — against your total budget. Create multiple scenarios to stress-test your project: "What if we lose the tax credit?" or "What if pre-sales come in 30% higher?"
              </p>
              <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
                This feeds into your Finance Readiness score and the waterfall chart — helping you see gaps before financiers do.
              </p>
            </div>
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
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');

  const handleAdd = () => {
    if (!form.person_name.trim()) return;
    addHOD.mutate(form);
    research(form.person_name, 'hod', projectContext, form.department, form.known_for);
    setForm({ department: 'Director', person_name: '', known_for: '', reputation_tier: 'emerging' });
    setAdding(false);
  };

  const handleSaveNote = (h: ProjectHOD) => {
    if (!noteInput.trim()) return;
    const timestamp = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const existingNotes = h.notes ? h.notes.trim() : '';
    const newEntry = `[${timestamp}] ${noteInput.trim()}`;
    const updatedNotes = existingNotes ? `${newEntry}\n${existingNotes}` : newEntry;
    updateHOD.mutate({ id: h.id, notes: updatedNotes });
    setNoteInput('');
  };

  return (
    <div className="space-y-3">
      {hods.map(h => {
        const isExpanded = expandedNotes === h.id;
        const noteLines = h.notes ? h.notes.split('\n').filter(Boolean) : [];
        return (
        <div key={h.id}>
          <div className="bg-muted/30 rounded-lg px-3 py-3 space-y-1.5">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <PersonNameLink
                    personName={h.person_name}
                    reason={`${h.department} · ${h.known_for}`}
                    projectContext={projectContext}
                    size="md"
                    onNameCorrected={(name) => updateHOD.mutate({ id: h.id, person_name: name })}
                    contactFields={{ agent_name: h.agent_name, manager_name: h.manager_name, agency: h.agency, contact_phone: h.contact_phone, contact_email: h.contact_email }}
                    onContactSave={(fields) => updateHOD.mutate({ id: h.id, ...fields })}
                    onExternalIds={(ids) => updateHOD.mutate({ id: h.id, imdb_id: ids.imdb_id || '', tmdb_id: ids.tmdb_id || '' })}
                  />
                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{h.department}</span>
                  <Badge className={`text-[10px] px-1.5 py-0 border ${REPUTATION_STYLES[h.reputation_tier] || ''}`}>
                    {h.reputation_tier}
                  </Badge>
                </div>
                {h.known_for && <p className="text-xs text-muted-foreground mt-1 ml-12 truncate">{h.known_for}</p>}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${noteLines.length > 0 ? 'text-primary' : 'text-muted-foreground'} hover:text-primary`}
                  onClick={() => setExpandedNotes(isExpanded ? null : h.id)}
                  title="Notes & activity"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Select value={h.status} onValueChange={v => updateHOD.mutate({ id: h.id, status: v })}>
                <SelectTrigger className={`w-28 h-7 text-xs border ${STATUS_STYLES[h.status] || ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wishlist">Wishlist</SelectItem>
                  <SelectItem value="approached">Approached</SelectItem>
                  <SelectItem value="in-talks">In Talks</SelectItem>
                  <SelectItem value="offer-out">Offer Out</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteHOD.mutate(h.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Expandable notes section */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden ml-12"
                >
                  <div className="pt-2 border-t border-border/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Add a note (e.g. 'Agent says avail Q2, quote $X')"
                        value={expandedNotes === h.id ? noteInput : ''}
                        onChange={e => setNoteInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveNote(h)}
                        className="h-7 text-xs flex-1"
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={() => handleSaveNote(h)} disabled={!noteInput.trim()}>
                        <Send className="h-3 w-3" />
                      </Button>
                    </div>
                    {noteLines.length > 0 && (
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {noteLines.map((line, i) => (
                          <p key={i} className="text-xs text-muted-foreground leading-relaxed">{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {assessments[h.person_name] && (
            <PersonAssessmentCard assessment={assessments[h.person_name]} onDismiss={() => clearAssessment(h.person_name)} />
          )}
        </div>
        );
      })}

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
  projectTitle?: string;
  format?: string;
  genres?: string[];
  budgetRange?: string;
  tone?: string;
  assignedLane?: string | null;
  scriptCharacters?: import('@/hooks/useScriptCharacters').ScriptCharacter[];
  scriptCharactersLoading?: boolean;
}

export function ProjectAttachmentTabs({ projectId, projectContext, projectTitle, format, genres, budgetRange, tone, assignedLane, scriptCharacters, scriptCharactersLoading }: Props) {
  const smartPackagingProps = projectTitle ? { projectId, projectTitle, format: format || '', genres: genres || [], budgetRange: budgetRange || '', tone: tone || '', assignedLane: assignedLane || null, scriptCharacters, scriptCharactersLoading } : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
    >
      <Tabs defaultValue="cast" className="space-y-4">
        <TabsList className="bg-muted/50 w-full grid grid-cols-4">
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
        </TabsList>
        <TabsContent value="cast">
          <CastTab projectId={projectId} projectContext={projectContext} />
          {smartPackagingProps && <SmartPackaging {...smartPackagingProps} />}
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
      </Tabs>
    </motion.div>
  );
}
