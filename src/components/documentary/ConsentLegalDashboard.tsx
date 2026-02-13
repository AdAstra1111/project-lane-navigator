/**
 * Consent & Legal Dashboard — Track releases, legal flags, and risk for documentaries.
 */

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, CheckCircle2, Clock, FileText, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

const FLAG_TYPES = ['defamation', 'privacy', 'copyright', 'contempt', 'national_security', 'commercial'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const CONSENT_STATUSES = ['pending', 'sent', 'signed', 'expired', 'revoked'];

export function ConsentLegalDashboard({ projectId }: Props) {
  const { user } = useAuth();
  const [consentForms, setConsentForms] = useState<any[]>([]);
  const [legalFlags, setLegalFlags] = useState<any[]>([]);
  const [showAddConsent, setShowAddConsent] = useState(false);
  const [showAddFlag, setShowAddFlag] = useState(false);
  const [newConsent, setNewConsent] = useState({ subject_name: '', form_type: 'appearance', status: 'pending' });
  const [newFlag, setNewFlag] = useState({ flag_type: 'defamation', severity: 'medium', description: '', affected_subjects: '' });

  useEffect(() => { fetchData(); }, [projectId]);

  const fetchData = async () => {
    const [{ data: consents }, { data: flags }] = await Promise.all([
      supabase.from('consent_forms').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('legal_flags').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ]);
    setConsentForms(consents || []);
    setLegalFlags(flags || []);
  };

  const addConsent = async () => {
    if (!user || !newConsent.subject_name) return;
    await supabase.from('consent_forms').insert({
      project_id: projectId, user_id: user.id, ...newConsent,
    } as any);
    toast.success('Consent form added');
    setShowAddConsent(false);
    setNewConsent({ subject_name: '', form_type: 'appearance', status: 'pending' });
    fetchData();
  };

  const addFlag = async () => {
    if (!user || !newFlag.description) return;
    await supabase.from('legal_flags').insert({
      project_id: projectId, user_id: user.id, ...newFlag,
    } as any);
    toast.success('Legal flag added');
    setShowAddFlag(false);
    setNewFlag({ flag_type: 'defamation', severity: 'medium', description: '', affected_subjects: '' });
    fetchData();
  };

  const statusIcon = (status: string) => {
    if (status === 'signed') return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
    if (status === 'expired' || status === 'revoked') return <AlertTriangle className="h-3 w-3 text-red-400" />;
    return <Clock className="h-3 w-3 text-amber-400" />;
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return 'border-red-500/40 text-red-400 bg-red-500/10';
    if (s === 'high') return 'border-amber-500/40 text-amber-400 bg-amber-500/10';
    if (s === 'medium') return 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10';
    return 'border-muted text-muted-foreground';
  };

  const signed = consentForms.filter(c => c.status === 'signed').length;
  const pending = consentForms.filter(c => c.status === 'pending' || c.status === 'sent').length;
  const criticalFlags = legalFlags.filter(f => f.severity === 'critical' || f.severity === 'high').length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
          <div className="text-2xl font-mono font-bold text-emerald-400">{signed}</div>
          <div className="text-[10px] text-emerald-400">Signed</div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center">
          <div className="text-2xl font-mono font-bold text-amber-400">{pending}</div>
          <div className="text-[10px] text-amber-400">Pending</div>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center">
          <div className="text-2xl font-mono font-bold text-red-400">{criticalFlags}</div>
          <div className="text-[10px] text-red-400">High/Critical Flags</div>
        </div>
      </div>

      {/* Consent Forms */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Consent Forms ({consentForms.length})
          </h5>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowAddConsent(!showAddConsent)}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>

        {showAddConsent && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded border border-border bg-muted/30">
            <Input
              value={newConsent.subject_name}
              onChange={e => setNewConsent(prev => ({ ...prev, subject_name: e.target.value }))}
              placeholder="Subject name"
              className="h-7 text-xs flex-1"
            />
            <Select value={newConsent.form_type} onValueChange={v => setNewConsent(prev => ({ ...prev, form_type: v }))}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['appearance', 'interview', 'location', 'archive', 'music'].map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-[10px]" onClick={addConsent}>Save</Button>
          </div>
        )}

        <div className="space-y-1">
          {consentForms.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
              {statusIcon(c.status)}
              <span className="text-foreground flex-1">{c.subject_name}</span>
              <span className="text-muted-foreground">{c.form_type}</span>
              <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
            </div>
          ))}
          {consentForms.length === 0 && <p className="text-xs text-muted-foreground italic">No consent forms tracked yet.</p>}
        </div>
      </div>

      {/* Legal Flags */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <Shield className="h-3 w-3" /> Legal Flags ({legalFlags.length})
          </h5>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowAddFlag(!showAddFlag)}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>

        {showAddFlag && (
          <div className="space-y-2 mb-2 p-2 rounded border border-border bg-muted/30">
            <div className="flex gap-2">
              <Select value={newFlag.flag_type} onValueChange={v => setNewFlag(prev => ({ ...prev, flag_type: v }))}>
                <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FLAG_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={newFlag.severity} onValueChange={v => setNewFlag(prev => ({ ...prev, severity: v }))}>
                <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input
              value={newFlag.description}
              onChange={e => setNewFlag(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Description of legal risk"
              className="h-7 text-xs"
            />
            <Button size="sm" className="h-7 text-[10px]" onClick={addFlag}>Add Flag</Button>
          </div>
        )}

        <div className="space-y-1">
          {legalFlags.map(f => (
            <div key={f.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="text-foreground flex-1">{f.description}</span>
              <Badge variant="outline" className={`text-[10px] ${severityColor(f.severity)}`}>
                {f.severity}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{f.flag_type}</Badge>
            </div>
          ))}
          {legalFlags.length === 0 && <p className="text-xs text-muted-foreground italic">No legal flags raised.</p>}
        </div>
      </div>
    </div>
  );
}
