import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileSignature, Plus, Trash2, Check, X, ChevronDown, ChevronRight, AlertTriangle, Clock, Calendar, User, Globe, DollarSign, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjectContracts, useProjectParticipants, type ProjectContract } from '@/hooks/useOwnership';

const CONTRACT_TYPES = [
  { value: 'investment', label: 'Investment' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'co-production', label: 'Co-Production' },
  { value: 'talent', label: 'Talent' },
  { value: 'license', label: 'License' },
  { value: 'services', label: 'Services' },
  { value: 'financing', label: 'Financing' },
  { value: 'other', label: 'Other' },
];

const CONTRACT_STATUSES = [
  { value: 'draft', label: 'Draft', style: 'bg-muted text-muted-foreground border-border' },
  { value: 'under-review', label: 'Under Review', style: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { value: 'negotiating', label: 'Negotiating', style: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  { value: 'executed', label: 'Executed', style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { value: 'expired', label: 'Expired', style: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { value: 'terminated', label: 'Terminated', style: 'bg-red-500/15 text-red-400 border-red-500/30' },
];

function getStatusStyle(status: string) {
  return CONTRACT_STATUSES.find(s => s.value === status)?.style || CONTRACT_STATUSES[0].style;
}

function getExpiryWarning(expiresAt: string | null): { label: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'Expired', urgent: true };
  if (days <= 30) return { label: `${days}d to expiry`, urgent: true };
  if (days <= 90) return { label: `${days}d to expiry`, urgent: false };
  return null;
}

interface Props {
  projectId: string;
}

export function ContractManagerPanel({ projectId }: Props) {
  const { contracts, addContract, updateContract, deleteContract } = useProjectContracts(projectId);
  const { participants } = useProjectParticipants(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: '',
    contract_type: 'investment',
    participant_id: '',
    territory: '',
    total_value: '',
    currency: 'USD',
    rights_granted: '',
    term_years: '',
    notes: '',
  });

  const expiryAlerts = useMemo(() => {
    return contracts
      .filter(c => c.status === 'executed' && c.expires_at)
      .map(c => ({ contract: c, warning: getExpiryWarning(c.expires_at) }))
      .filter(a => a.warning !== null);
  }, [contracts]);

  const stats = useMemo(() => ({
    total: contracts.length,
    executed: contracts.filter(c => c.status === 'executed').length,
    negotiating: contracts.filter(c => c.status === 'negotiating' || c.status === 'under-review').length,
    totalValue: contracts
      .filter(c => c.status === 'executed' && c.total_value)
      .reduce((s, c) => s + (parseFloat(c.total_value.replace(/[^0-9.]/g, '')) || 0), 0),
  }), [contracts]);

  const handleAdd = () => {
    if (!form.title.trim()) return;
    addContract.mutate({
      title: form.title,
      contract_type: form.contract_type,
      participant_id: form.participant_id || null,
      territory: form.territory,
      total_value: form.total_value,
      currency: form.currency,
      rights_granted: form.rights_granted,
      term_years: form.term_years,
      notes: form.notes,
    });
    setForm({ title: '', contract_type: 'investment', participant_id: '', territory: '', total_value: '', currency: 'USD', rights_granted: '', term_years: '', notes: '' });
    setAdding(false);
  };

  const handleStatusChange = (id: string, status: string) => {
    const updates: Partial<ProjectContract> & { id: string } = { id, status };
    if (status === 'executed') updates.executed_at = new Date().toISOString();
    updateContract.mutate(updates);
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      {contracts.length > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Total', value: stats.total },
            { label: 'Executed', value: stats.executed },
            { label: 'In Progress', value: stats.negotiating },
            { label: 'Value', value: stats.totalValue > 0 ? `$${Math.round(stats.totalValue).toLocaleString()}` : '—' },
          ].map(s => (
            <div key={s.label} className="bg-muted/30 rounded-lg px-2 py-1.5">
              <p className="text-lg font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <div className="space-y-1.5">
          {expiryAlerts.map(({ contract, warning }) => (
            <div key={contract.id} className="flex items-center gap-2 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-xs text-foreground flex-1 truncate">{contract.title}</span>
              <Badge className="text-[10px] px-1.5 py-0 border bg-amber-500/15 text-amber-400 border-amber-500/30">
                {warning!.label}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Contract list */}
      <div className="space-y-1.5">
        {contracts.map(c => {
          const isExpanded = expandedId === c.id;
          const participant = participants.find(p => p.id === c.participant_id);
          const expiry = getExpiryWarning(c.expires_at);
          return (
            <div key={c.id} className="bg-muted/20 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                <FileSignature className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-medium text-foreground flex-1 truncate">{c.title || 'Untitled'}</span>
                <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${getStatusStyle(c.status)}`}>
                  {CONTRACT_STATUSES.find(s => s.value === c.status)?.label || c.status}
                </Badge>
                {expiry && (
                  <Badge className="text-[9px] px-1.5 py-0 border bg-amber-500/15 text-amber-400 border-amber-500/30 shrink-0">
                    {expiry.label}
                  </Badge>
                )}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-3 pb-3 space-y-3"
                  >
                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Type:</span>
                        <span className="text-foreground">{CONTRACT_TYPES.find(t => t.value === c.contract_type)?.label || c.contract_type}</span>
                      </div>
                      {participant && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Party:</span>
                          <span className="text-foreground truncate">{participant.participant_name}</span>
                        </div>
                      )}
                      {c.territory && (
                        <div className="flex items-center gap-1.5">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Territory:</span>
                          <span className="text-foreground">{c.territory}</span>
                        </div>
                      )}
                      {c.total_value && (
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Value:</span>
                          <span className="text-foreground">{c.currency} {c.total_value}</span>
                        </div>
                      )}
                      {c.term_years && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Term:</span>
                          <span className="text-foreground">{c.term_years}</span>
                        </div>
                      )}
                      {c.executed_at && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Executed:</span>
                          <span className="text-foreground">{new Date(c.executed_at).toLocaleDateString()}</span>
                        </div>
                      )}
                      {c.expires_at && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Expires:</span>
                          <span className="text-foreground">{new Date(c.expires_at).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    {c.rights_granted && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Rights: </span>
                        <span className="text-foreground">{c.rights_granted}</span>
                      </div>
                    )}

                    {c.notes && (
                      <p className="text-xs text-muted-foreground">{c.notes}</p>
                    )}

                    {/* Key terms */}
                    {c.key_terms && Object.keys(c.key_terms).length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Key Terms</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(c.key_terms).map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {k}: {String(v)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Version badge */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>v{c.version}</span>
                      <span>·</span>
                      <span>Created {new Date(c.created_at).toLocaleDateString()}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <Select value={c.status} onValueChange={v => handleStatusChange(c.id, v)}>
                        <SelectTrigger className="h-7 text-[10px] w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTRACT_STATUSES.map(s => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {c.status !== 'executed' && !c.expires_at && (
                        <Input
                          type="date"
                          placeholder="Expiry"
                          className="h-7 text-[10px] w-32"
                          onChange={e => e.target.value && updateContract.mutate({ id: c.id, expires_at: new Date(e.target.value).toISOString() })}
                        />
                      )}
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteContract.mutate(c.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Add contract form */}
      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input
            placeholder="Contract title"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="h-8 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {participants.length > 0 && (
              <Select value={form.participant_id} onValueChange={v => setForm(f => ({ ...f, participant_id: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Link participant…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs text-muted-foreground">None</SelectItem>
                  {participants.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.participant_name} ({p.participant_type})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Territory" value={form.territory} onChange={e => setForm(f => ({ ...f, territory: e.target.value }))} className="h-8 text-xs" />
            <Input placeholder="Value" value={form.total_value} onChange={e => setForm(f => ({ ...f, total_value: e.target.value }))} className="h-8 text-xs" />
            <Input placeholder="Term (e.g. 5 years)" value={form.term_years} onChange={e => setForm(f => ({ ...f, term_years: e.target.value }))} className="h-8 text-xs" />
          </div>
          <Input placeholder="Rights granted" value={form.rights_granted} onChange={e => setForm(f => ({ ...f, rights_granted: e.target.value }))} className="h-8 text-xs" />
          <Textarea placeholder="Notes…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-xs min-h-[60px]" />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={!form.title.trim()} className="text-xs">Add Contract</Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} className="text-xs">Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <FileSignature className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Contract Manager</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Track contracts with participants — investment agreements, distribution deals, talent deals, and more. Monitor execution status and expiry dates.
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
