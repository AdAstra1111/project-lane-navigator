/**
 * Archive Budget Forecasting — Track archive assets, costs, and clearance status.
 */

import { useState, useEffect } from 'react';
import { Archive, Plus, DollarSign, Film, Image, FileText, Music } from 'lucide-react';
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

const ASSET_TYPES = ['footage', 'photo', 'document', 'audio', 'news_clip', 'social_media'];
const RIGHTS_STATUSES = ['unknown', 'public_domain', 'licensed', 'pending', 'cleared', 'denied'];

const typeIcons: Record<string, any> = {
  footage: Film, photo: Image, document: FileText, audio: Music,
  news_clip: Film, social_media: Image,
};

export function ArchiveBudgetPanel({ projectId }: Props) {
  const { user } = useAuth();
  const [assets, setAssets] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newAsset, setNewAsset] = useState({
    asset_type: 'footage', description: '', source: '',
    rights_status: 'unknown', cost_estimate: 0, priority: 'medium',
  });

  useEffect(() => { fetchAssets(); }, [projectId]);

  const fetchAssets = async () => {
    const { data } = await supabase
      .from('archive_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    setAssets(data || []);
  };

  const addAsset = async () => {
    if (!user || !newAsset.description) return;
    await supabase.from('archive_assets').insert({
      project_id: projectId, user_id: user.id, ...newAsset,
    } as any);
    toast.success('Archive asset added');
    setShowAdd(false);
    setNewAsset({ asset_type: 'footage', description: '', source: '', rights_status: 'unknown', cost_estimate: 0, priority: 'medium' });
    fetchAssets();
  };

  const totalCost = assets.reduce((sum, a) => sum + (Number(a.cost_estimate) || 0), 0);
  const cleared = assets.filter(a => a.rights_status === 'cleared' || a.rights_status === 'public_domain').length;
  const pending = assets.filter(a => a.rights_status === 'pending' || a.rights_status === 'unknown').length;

  const rightsColor = (s: string) => {
    if (s === 'cleared' || s === 'public_domain') return 'border-emerald-500/40 text-emerald-400';
    if (s === 'denied') return 'border-red-500/40 text-red-400';
    if (s === 'pending' || s === 'licensed') return 'border-amber-500/40 text-amber-400';
    return 'border-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-mono font-bold text-foreground">{assets.length}</div>
          <div className="text-[10px] text-muted-foreground">Total Assets</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-mono font-bold text-foreground">
            ${totalCost.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground">Est. Archive Cost</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-mono font-bold text-foreground">{cleared}/{assets.length}</div>
          <div className="text-[10px] text-muted-foreground">Cleared</div>
        </div>
      </div>

      {/* Add Form */}
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Archive className="h-3 w-3" /> Archive Assets
        </h5>
        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>

      {showAdd && (
        <div className="space-y-2 p-2 rounded border border-border bg-muted/30">
          <div className="flex gap-2">
            <Select value={newAsset.asset_type} onValueChange={v => setNewAsset(prev => ({ ...prev, asset_type: v }))}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={newAsset.description}
              onChange={e => setNewAsset(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Description"
              className="h-7 text-xs flex-1"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={newAsset.source}
              onChange={e => setNewAsset(prev => ({ ...prev, source: e.target.value }))}
              placeholder="Source / Archive"
              className="h-7 text-xs flex-1"
            />
            <Input
              type="number"
              value={newAsset.cost_estimate || ''}
              onChange={e => setNewAsset(prev => ({ ...prev, cost_estimate: Number(e.target.value) }))}
              placeholder="Cost est."
              className="h-7 text-xs w-24"
            />
            <Select value={newAsset.rights_status} onValueChange={v => setNewAsset(prev => ({ ...prev, rights_status: v }))}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RIGHTS_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-7 text-[10px]" onClick={addAsset}>Add Asset</Button>
        </div>
      )}

      {/* Asset List */}
      <div className="space-y-1">
        {assets.map(a => {
          const Icon = typeIcons[a.asset_type] || FileText;
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/30">
              <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-foreground flex-1 truncate">{a.description}</span>
              {a.source && <span className="text-muted-foreground truncate max-w-[100px]">{a.source}</span>}
              {Number(a.cost_estimate) > 0 && (
                <span className="text-muted-foreground font-mono">${Number(a.cost_estimate).toLocaleString()}</span>
              )}
              <Badge variant="outline" className={`text-[10px] ${rightsColor(a.rights_status)}`}>
                {a.rights_status?.replace('_', ' ')}
              </Badge>
            </div>
          );
        })}
        {assets.length === 0 && <p className="text-xs text-muted-foreground italic">No archive assets tracked yet.</p>}
      </div>
    </div>
  );
}
