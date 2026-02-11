import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, FileSignature, PieChart, Layers, Plus, Trash2, X, Check, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoTooltip } from '@/components/InfoTooltip';
import {
  useProjectParticipants,
  useProjectContracts,
  useProjectOwnership,
  useProjectWaterfall,
  type ProjectParticipant,
  type ProjectContract,
  type ProjectOwnershipStake,
  type ProjectWaterfallRule,
} from '@/hooks/useOwnership';

// ---- Styles ----
const PARTICIPANT_TYPE_STYLES: Record<string, string> = {
  producer: 'bg-primary/15 text-primary border-primary/30',
  'executive-producer': 'bg-primary/15 text-primary border-primary/30',
  investor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'sales-agent': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  distributor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  talent: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  financier: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  lender: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  broadcaster: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  other: 'bg-muted text-muted-foreground border-border',
};

const CONTRACT_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  negotiating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  executed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  terminated: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const PARTICIPANT_TYPES = [
  'producer', 'executive-producer', 'investor', 'sales-agent',
  'distributor', 'talent', 'financier', 'lender', 'broadcaster', 'other',
];

const CONTRACT_TYPES = [
  'investment', 'sales-agency', 'distribution', 'talent', 'co-production', 'license', 'other',
];

const STAKE_TYPES = ['equity', 'copyright', 'profit-share', 'revenue-share', 'other'];
const RIGHTS_TYPES = ['all', 'theatrical', 'streaming', 'tv', 'ancillary', 'music', 'merch', 'other'];
const RULE_TYPES = ['recoupment', 'commission', 'deferment', 'profit-split', 'corridor', 'premium', 'cap', 'override'];

// ---- Participants Tab ----
function ParticipantsTab({ projectId }: { projectId: string }) {
  const { participants, addParticipant, deleteParticipant } = useProjectParticipants(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ participant_name: '', participant_type: 'producer', company: '', contact_email: '' });

  const handleAdd = () => {
    if (!form.participant_name.trim()) return;
    addParticipant.mutate(form);
    setForm({ participant_name: '', participant_type: 'producer', company: '', contact_email: '' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {participants.map(p => (
        <div key={p.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{p.participant_name}</span>
              <Badge className={`text-[10px] px-1.5 py-0 border ${PARTICIPANT_TYPE_STYLES[p.participant_type] || PARTICIPANT_TYPE_STYLES.other}`}>
                {p.participant_type}
              </Badge>
            </div>
            {p.company && <span className="text-xs text-muted-foreground">{p.company}</span>}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteParticipant.mutate(p.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Input placeholder="Name" value={form.participant_name} onChange={e => setForm(f => ({ ...f, participant_name: e.target.value }))} className="h-8 text-sm flex-1" />
            <Select value={form.participant_type} onValueChange={v => setForm(f => ({ ...f, participant_type: v }))}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARTICIPANT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace('-', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Company" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className="h-8 text-sm flex-1" />
            <Input placeholder="Email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} className="h-8 text-sm flex-1" />
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.participant_name.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {participants.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <Users className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Project Participants</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Add everyone with a financial stake in the project — producers, investors, sales agents, distributors, talent with backend participation. These participants feed into contracts, ownership stakes, and the recoupment waterfall.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Participant
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Contracts Tab ----
function ContractsTab({ projectId }: { projectId: string }) {
  const { contracts, addContract, updateContract, deleteContract } = useProjectContracts(projectId);
  const { participants } = useProjectParticipants(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', contract_type: 'investment', participant_id: '', total_value: '', territory: '' });

  const handleAdd = () => {
    if (!form.title.trim()) return;
    addContract.mutate({ ...form, participant_id: form.participant_id || null } as any);
    setForm({ title: '', contract_type: 'investment', participant_id: '', total_value: '', territory: '' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {contracts.map(c => (
        <div key={c.id} className="bg-muted/30 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{c.title}</span>
                <Badge className={`text-[10px] px-1.5 py-0 border ${CONTRACT_STATUS_STYLES[c.status] || ''}`}>
                  {c.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{c.contract_type}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {c.total_value && <span>{c.currency} {c.total_value}</span>}
                {c.territory && <span>· {c.territory}</span>}
                {c.participant_id && (
                  <span>· {participants.find(p => p.id === c.participant_id)?.participant_name || 'Unknown'}</span>
                )}
              </div>
            </div>
            <Select value={c.status} onValueChange={v => updateContract.mutate({ id: c.id, status: v })}>
              <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="negotiating">Negotiating</SelectItem>
                <SelectItem value="executed">Executed</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteContract.mutate(c.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Contract title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="h-8 text-sm" />
          <div className="flex items-center gap-2">
            <Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace('-', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            {participants.length > 0 && (
              <Select value={form.participant_id || undefined} onValueChange={v => setForm(f => ({ ...f, participant_id: v }))}>
                <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Link to participant" /></SelectTrigger>
                <SelectContent>
                  {participants.map(p => <SelectItem key={p.id} value={p.id}>{p.participant_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Value (e.g. 500000)" value={form.total_value} onChange={e => setForm(f => ({ ...f, total_value: e.target.value }))} className="h-8 text-sm flex-1" />
            <Input placeholder="Territory" value={form.territory} onChange={e => setForm(f => ({ ...f, territory: e.target.value }))} className="h-8 text-sm w-28" />
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.title.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <FileSignature className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Deal Terms</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Structure deal terms as data — not just PDFs. Link contracts to participants to track who has committed what, and feed terms into the ownership and waterfall engines.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Contract
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Ownership Tab ----
function OwnershipTab({ projectId }: { projectId: string }) {
  const { stakes, addStake, deleteStake } = useProjectOwnership(projectId);
  const { participants } = useProjectParticipants(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ participant_id: '', stake_type: 'equity', percentage: '', territory: 'worldwide', rights_type: 'all' });

  const totalPct = useMemo(() => stakes.reduce((sum, s) => sum + Number(s.percentage), 0), [stakes]);

  const handleAdd = () => {
    if (!form.participant_id || !form.percentage) return;
    addStake.mutate({ ...form, participant_id: form.participant_id, percentage: parseFloat(form.percentage) } as any);
    setForm({ participant_id: '', stake_type: 'equity', percentage: '', territory: 'worldwide', rights_type: 'all' });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {/* Ownership pie summary */}
      {stakes.length > 0 && (
        <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total Allocated</span>
            <span className={`font-medium ${totalPct > 100 ? 'text-red-400' : totalPct === 100 ? 'text-emerald-400' : 'text-foreground'}`}>
              {totalPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(totalPct, 100)}%`,
                background: totalPct > 100 ? 'hsl(0, 70%, 55%)' : totalPct >= 90 ? 'hsl(var(--primary))' : 'hsl(35, 90%, 55%)',
              }}
            />
          </div>
          {totalPct > 100 && (
            <p className="text-[10px] text-red-400">⚠ Over-allocated — total exceeds 100%</p>
          )}
        </div>
      )}

      {stakes.map(s => {
        const participant = participants.find(p => p.id === s.participant_id);
        return (
          <div key={s.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{participant?.participant_name || 'Unknown'}</span>
                <span className="text-xs font-semibold text-primary">{Number(s.percentage).toFixed(1)}%</span>
                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{s.stake_type}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {s.territory} · {s.rights_type} rights
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteStake.mutate(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          {participants.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add participants first before assigning ownership.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select value={form.participant_id || undefined} onValueChange={v => setForm(f => ({ ...f, participant_id: v }))}>
                  <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select participant" /></SelectTrigger>
                  <SelectContent>
                    {participants.map(p => <SelectItem key={p.id} value={p.id}>{p.participant_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="%" value={form.percentage} onChange={e => setForm(f => ({ ...f, percentage: e.target.value }))} className="h-8 text-sm w-20" type="number" step="0.1" />
              </div>
              <div className="flex items-center gap-2">
                <Select value={form.stake_type} onValueChange={v => setForm(f => ({ ...f, stake_type: v }))}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAKE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace('-', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={form.rights_type} onValueChange={v => setForm(f => ({ ...f, rights_type: v }))}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RIGHTS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.participant_id || !form.percentage}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {stakes.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <PieChart className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Ownership Map</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Track who owns what percentage of the project. Ownership stakes link to participants and feed into the recoupment waterfall — so you always know who benefits from revenue.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Ownership Stake
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Waterfall Tab ----
function WaterfallTab({ projectId }: { projectId: string }) {
  const { rules, addRule, updateRule, deleteRule } = useProjectWaterfall(projectId);
  const { participants } = useProjectParticipants(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ rule_name: '', rule_type: 'recoupment', participant_id: '', percentage: '', cap_amount: '' });

  const handleAdd = () => {
    if (!form.rule_name.trim()) return;
    addRule.mutate({
      ...form,
      participant_id: form.participant_id || null,
      percentage: parseFloat(form.percentage) || 0,
    } as any);
    setForm({ rule_name: '', rule_type: 'recoupment', participant_id: '', percentage: '', cap_amount: '' });
    setAdding(false);
  };

  const moveRule = (ruleId: string, direction: 'up' | 'down') => {
    const idx = rules.findIndex(r => r.id === ruleId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rules.length) return;
    updateRule.mutate({ id: rules[idx].id, position: rules[swapIdx].position });
    updateRule.mutate({ id: rules[swapIdx].id, position: rules[idx].position });
  };

  return (
    <div className="space-y-3">
      {/* Waterfall visualization */}
      {rules.length > 0 && (
        <div className="space-y-1">
          {rules.map((r, i) => {
            const participant = participants.find(p => p.id === r.participant_id);
            return (
              <div key={r.id} className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground" onClick={() => moveRule(r.id, 'up')} disabled={i === 0}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground" onClick={() => moveRule(r.id, 'down')} disabled={i === rules.length - 1}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.rule_name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{r.rule_type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {participant?.participant_name || 'Unlinked'}
                    {Number(r.percentage) > 0 && ` · ${Number(r.percentage)}%`}
                    {r.cap_amount && ` · Cap: ${r.cap_amount}`}
                    {Number(r.premium_pct) > 0 && ` · ${Number(r.premium_pct)}% premium`}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteRule.mutate(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Rule name (e.g. 'Investor Recoupment')" value={form.rule_name} onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))} className="h-8 text-sm" />
          <div className="flex items-center gap-2">
            <Select value={form.rule_type} onValueChange={v => setForm(f => ({ ...f, rule_type: v }))}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace('-', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            {participants.length > 0 && (
              <Select value={form.participant_id || undefined} onValueChange={v => setForm(f => ({ ...f, participant_id: v }))}>
                <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Participant" /></SelectTrigger>
                <SelectContent>
                  {participants.map(p => <SelectItem key={p.id} value={p.id}>{p.participant_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="%" value={form.percentage} onChange={e => setForm(f => ({ ...f, percentage: e.target.value }))} className="h-8 text-sm w-20" type="number" />
            <Input placeholder="Cap amount" value={form.cap_amount} onChange={e => setForm(f => ({ ...f, cap_amount: e.target.value }))} className="h-8 text-sm flex-1" />
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.rule_name.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <Layers className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Recoupment Waterfall</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Define the order money flows back to participants. Position 1 gets paid first. Set recoupment amounts, commission percentages, caps, premiums, and corridors. This works before contracts are signed (planning) and after revenues arrive (actual recoupment).
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Waterfall Rule
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Main Panel ----
interface Props {
  projectId: string;
}

export function OwnershipWaterfallPanel({ projectId }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
    >
      <Tabs defaultValue="participants" className="space-y-4">
        <TabsList className="bg-muted/50 w-full grid grid-cols-4">
          <TabsTrigger value="participants" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Participants
          </TabsTrigger>
          <TabsTrigger value="contracts" className="gap-1.5 text-xs">
            <FileSignature className="h-3.5 w-3.5" /> Contracts
          </TabsTrigger>
          <TabsTrigger value="ownership" className="gap-1.5 text-xs">
            <PieChart className="h-3.5 w-3.5" /> Ownership
          </TabsTrigger>
          <TabsTrigger value="waterfall" className="gap-1.5 text-xs">
            <Layers className="h-3.5 w-3.5" /> Waterfall
          </TabsTrigger>
        </TabsList>

        <TabsContent value="participants">
          <ParticipantsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="contracts">
          <ContractsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="ownership">
          <OwnershipTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="waterfall">
          <WaterfallTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
