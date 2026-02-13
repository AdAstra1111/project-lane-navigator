/**
 * Impact Campaign Planner — NGO strategy, university rollout, festival impact, press narrative.
 */

import { useState } from 'react';
import { Globe, Users, GraduationCap, Newspaper, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  projectId: string;
}

interface ImpactPlan {
  ngo_strategy: string;
  university_rollout: string;
  festival_impact: string;
  press_narrative: string;
}

export function ImpactCampaignPanel({ projectId }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ImpactPlan | null>(null);
  const [context, setContext] = useState('');

  const generatePlan = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: docs } = await supabase
        .from('project_documents')
        .select('extracted_text, file_name')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(3);

      const docText = (docs || [])
        .filter((d: any) => d.extracted_text)
        .map((d: any) => d.extracted_text)
        .join('\n\n')
        .slice(0, 10000);

      const { data: project } = await supabase
        .from('projects')
        .select('title, genres, tone, target_audience')
        .eq('id', projectId)
        .single();

      // Use simple template-based plan for now
      setPlan({
        ngo_strategy: `Based on "${project?.title || 'this project'}", identify NGOs working on ${(project?.genres || []).join(', ')}. Approach as screening partners, educational distribution allies, and advocacy amplifiers. ${context ? `Additional context: ${context}` : ''}`,
        university_rollout: `Target film studies, journalism, and ${(project?.genres || []).join('/')} departments. Offer screening licenses, study guides, and filmmaker Q&A sessions. Partner with student unions for campus screenings.`,
        festival_impact: `Submit to documentary festivals with impact screening programmes (IDFA, Sheffield DocFest, Hot Docs, Sundance). Request community screening events and panel discussions. Build audience engagement toolkit for festival programmers.`,
        press_narrative: `Position as a ${project?.tone || 'compelling'} investigation into ${(project?.genres || []).join(' and ')}. Target specialist press first (documentary outlets, subject-area journalists), then broaden to mainstream cultural coverage timed to festival premiere.`,
      });
      toast.success('Impact plan generated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  };

  const sections = plan ? [
    { key: 'ngo_strategy', label: 'NGO Strategy', icon: Users, text: plan.ngo_strategy },
    { key: 'university_rollout', label: 'University Rollout', icon: GraduationCap, text: plan.university_rollout },
    { key: 'festival_impact', label: 'Festival Impact Plan', icon: Globe, text: plan.festival_impact },
    { key: 'press_narrative', label: 'Press Narrative', icon: Newspaper, text: plan.press_narrative },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-sm font-medium text-foreground">Impact Campaign Planner</h5>
          <p className="text-xs text-muted-foreground">NGO, university, festival, and press strategies</p>
        </div>
        <Button size="sm" onClick={generatePlan} disabled={loading} className="gap-1.5 text-xs">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Generate Plan
        </Button>
      </div>

      {!plan && (
        <div>
          <Textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Optional: Add context about your impact goals, target communities, or partner organisations…"
            className="text-xs"
            rows={3}
          />
        </div>
      )}

      {plan && (
        <div className="space-y-3">
          {sections.map(({ key, label, icon: Icon, text }) => (
            <div key={key} className="rounded-lg border border-border/50 p-3 bg-muted/20">
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">{label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
