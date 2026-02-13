import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Rocket, FolderPlus, FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { PitchIdea } from '@/hooks/usePitchIdeas';
import { useProjects } from '@/hooks/useProjects';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OperationProgress, PROMOTE_STAGES } from '@/components/OperationProgress';

const BUDGET_BANDS = ['Micro (<$500K)', 'Low ($500K–$2M)', 'Mid ($2M–$10M)', 'Mid-High ($10M–$25M)', 'High ($25M–$50M)', 'Studio ($50M+)'];
const PRODUCTION_TYPES = ['feature_film', 'tv_series', 'limited_series', 'documentary', 'short_film', 'animation'];
const STRATEGIC_PRIORITIES = ['PRESTIGE', 'BALANCED', 'COMMERCIAL_EXPANSION', 'CASHFLOW_STABILISATION'];

interface Props {
  idea: PitchIdea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendToProjectDialog({ idea, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const [action, setAction] = useState<'CREATE_NEW' | 'ADD_TO_EXISTING'>('CREATE_NEW');
  const [existingProjectId, setExistingProjectId] = useState('');
  const [productionType, setProductionType] = useState(idea.production_type || 'feature_film');
  const [budgetRange, setBudgetRange] = useState(idea.budget_band || '');
  const [strategicPriority, setStrategicPriority] = useState('BALANCED');
  const [developmentStage, setDevelopmentStage] = useState('IDEA');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-project-from-pitch-idea', {
        body: {
          pitchIdeaId: idea.id,
          action,
          existingProjectId: action === 'ADD_TO_EXISTING' ? existingProjectId : undefined,
          overrides: { productionType, budgetRange, strategicPriority },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Project created — opening Development Engine');
      onOpenChange(false);
      navigate(`/projects/${data.projectId}/development?doc=${data.documentId}&version=${data.versionId}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create project');
    } finally {
      setSending(false);
    }
  };

  const canSubmit = action === 'CREATE_NEW' || (action === 'ADD_TO_EXISTING' && existingProjectId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Send to Project
          </DialogTitle>
          <DialogDescription>
            Create a project from this idea and open the Development Engine to analyze and evolve it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Action tabs */}
          <Tabs value={action} onValueChange={(v) => setAction(v as any)}>
            <TabsList className="w-full">
              <TabsTrigger value="CREATE_NEW" className="flex-1 gap-1.5 text-xs">
                <FolderPlus className="h-3.5 w-3.5" /> New Project
              </TabsTrigger>
              <TabsTrigger value="ADD_TO_EXISTING" className="flex-1 gap-1.5 text-xs">
                <FolderOpen className="h-3.5 w-3.5" /> Existing Project
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ADD_TO_EXISTING" className="mt-3">
              <Select value={existingProjectId} onValueChange={setExistingProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TabsContent>
          </Tabs>

          {/* Idea summary */}
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">{idea.title}</p>
            <p className="line-clamp-2">{idea.logline}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              <Badge variant="secondary" className="text-[10px]">{idea.genre}</Badge>
              {idea.budget_band && <Badge variant="outline" className="text-[10px]">{idea.budget_band}</Badge>}
            </div>
          </div>

          {/* Overrides */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Production Type</Label>
              <Select value={productionType} onValueChange={setProductionType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Budget Range</Label>
              <Select value={budgetRange} onValueChange={setBudgetRange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select budget" /></SelectTrigger>
                <SelectContent>
                  {BUDGET_BANDS.map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Strategic Priority</Label>
                <Select value={strategicPriority} onValueChange={setStrategicPriority}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STRATEGIC_PRIORITIES.map(s => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Dev Stage</Label>
                <Select value={developmentStage} onValueChange={setDevelopmentStage}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IDEA">Idea</SelectItem>
                    <SelectItem value="EARLY_DRAFT">Early Draft</SelectItem>
                    <SelectItem value="REDRAFT">Redraft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <OperationProgress isActive={sending} stages={PROMOTE_STAGES} className="py-1" />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || !canSubmit} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Create & Open Dev Engine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
