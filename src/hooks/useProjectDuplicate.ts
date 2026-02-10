import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export function useProjectDuplicate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const duplicate = useMutation({
    mutationFn: async (sourceProjectId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Fetch source project
      const { data: source, error: srcErr } = await supabase
        .from('projects')
        .select('*')
        .eq('id', sourceProjectId)
        .single();
      if (srcErr || !source) throw new Error('Source project not found');

      // 2. Create duplicate project
      const { data: newProject, error: insertErr } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: `${source.title} (Scenario)`,
          format: source.format,
          genres: source.genres,
          budget_range: source.budget_range,
          target_audience: source.target_audience,
          tone: source.tone,
          comparable_titles: source.comparable_titles,
          assigned_lane: source.assigned_lane,
          confidence: source.confidence,
          reasoning: source.reasoning,
          recommendations: source.recommendations,
          document_urls: source.document_urls,
          analysis_passes: source.analysis_passes,
        })
        .select()
        .single();
      if (insertErr || !newProject) throw new Error('Failed to create duplicate');

      const newId = (newProject as any).id;

      // 3. Copy all attachments in parallel
      const [castRes, hodsRes, partnersRes, scriptsRes, financeRes] = await Promise.all([
        supabase.from('project_cast').select('*').eq('project_id', sourceProjectId),
        supabase.from('project_hods').select('*').eq('project_id', sourceProjectId),
        supabase.from('project_partners').select('*').eq('project_id', sourceProjectId),
        supabase.from('project_scripts').select('*').eq('project_id', sourceProjectId),
        supabase.from('project_finance_scenarios').select('*').eq('project_id', sourceProjectId),
      ]);

      // Cast
      if (castRes.data?.length) {
        await supabase.from('project_cast').insert(
          castRes.data.map((c: any) => ({
            project_id: newId,
            user_id: user.id,
            role_name: c.role_name,
            actor_name: c.actor_name,
            status: c.status,
            territory_tags: c.territory_tags,
            notes: c.notes,
          }))
        );
      }

      // HODs
      if (hodsRes.data?.length) {
        await supabase.from('project_hods').insert(
          hodsRes.data.map((h: any) => ({
            project_id: newId,
            user_id: user.id,
            department: h.department,
            person_name: h.person_name,
            known_for: h.known_for,
            reputation_tier: h.reputation_tier,
            status: h.status,
            notes: h.notes,
          }))
        );
      }

      // Partners
      if (partnersRes.data?.length) {
        await supabase.from('project_partners').insert(
          partnersRes.data.map((p: any) => ({
            project_id: newId,
            user_id: user.id,
            partner_name: p.partner_name,
            partner_type: p.partner_type,
            status: p.status,
            territory: p.territory,
            notes: p.notes,
          }))
        );
      }

      // Scripts
      if (scriptsRes.data?.length) {
        await supabase.from('project_scripts').insert(
          scriptsRes.data.map((s: any) => ({
            project_id: newId,
            user_id: user.id,
            version_label: s.version_label,
            status: s.status,
            file_path: s.file_path,
            notes: s.notes,
          }))
        );
      }

      // Finance scenarios
      if (financeRes.data?.length) {
        await supabase.from('project_finance_scenarios').insert(
          financeRes.data.map((f: any) => ({
            project_id: newId,
            user_id: user.id,
            scenario_name: f.scenario_name,
            total_budget: f.total_budget,
            incentive_amount: f.incentive_amount,
            presales_amount: f.presales_amount,
            equity_amount: f.equity_amount,
            gap_amount: f.gap_amount,
            other_sources: f.other_sources,
            confidence: f.confidence,
            notes: f.notes,
          }))
        );
      }

      return { id: newId, title: (newProject as any).title };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Scenario created: ${result.title}`);
      navigate(`/projects/${result.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { duplicate };
}
