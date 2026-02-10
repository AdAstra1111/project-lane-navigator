import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PersonAssessment {
  summary: string;
  market_trajectory: 'rising' | 'peak' | 'steady' | 'declining' | 'breakout' | 'unknown';
  packaging_impact: 'transformative' | 'strong' | 'moderate' | 'marginal' | 'neutral' | 'risky';
  notable_credits: string[];
  risk_flags: string[];
}

interface ProjectContext {
  title?: string;
  format?: string;
  budget_range?: string;
  genres?: string[];
}

export function usePersonResearch() {
  const [loading, setLoading] = useState<string | null>(null); // person name being researched
  const [assessments, setAssessments] = useState<Record<string, PersonAssessment>>({});

  const research = async (personName: string, role: 'cast' | 'hod', projectContext?: ProjectContext, department?: string) => {
    if (!personName.trim()) return;
    setLoading(personName);

    try {
      const { data, error } = await supabase.functions.invoke('research-person', {
        body: {
          person_name: personName,
          role,
          project_context: { ...projectContext, department },
        },
      });

      if (error) throw error;
      if (data?.error) {
        if (data.error.includes('Rate limit')) {
          toast.error('Rate limit reached — please try again shortly.');
        } else if (data.error.includes('credits')) {
          toast.error('AI credits exhausted.');
        } else {
          throw new Error(data.error);
        }
        return;
      }

      setAssessments(prev => ({ ...prev, [personName]: data as PersonAssessment }));
    } catch (e) {
      console.error('Person research error:', e);
      toast.error('Could not assess this person right now.');
    } finally {
      setLoading(null);
    }
  };

  const clearAssessment = (personName: string) => {
    setAssessments(prev => {
      const next = { ...prev };
      delete next[personName];
      return next;
    });
  };

  return { research, loading, assessments, clearAssessment };
}
