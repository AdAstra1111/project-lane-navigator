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

export interface DisambiguationCandidate {
  name: string;
  descriptor: string;
  known_for: string;
}

interface ProjectContext {
  title?: string;
  format?: string;
  budget_range?: string;
  genres?: string[];
}

export function usePersonResearch() {
  const [loading, setLoading] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Record<string, PersonAssessment>>({});
  const [candidates, setCandidates] = useState<DisambiguationCandidate[] | null>(null);
  const [pendingResearch, setPendingResearch] = useState<{
    personName: string;
    role: 'cast' | 'hod';
    projectContext?: ProjectContext;
    department?: string;
  } | null>(null);

  const research = async (personName: string, role: 'cast' | 'hod', projectContext?: ProjectContext, department?: string) => {
    if (!personName.trim()) return;
    setLoading(personName);
    setCandidates(null);

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

      // Check if disambiguation is needed
      if (data?.disambiguation && data?.candidates) {
        setCandidates(data.candidates);
        setPendingResearch({ personName, role, projectContext, department });
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

  const confirmCandidate = async (candidate: DisambiguationCandidate) => {
    if (!pendingResearch) return;
    const { personName, role, projectContext, department } = pendingResearch;

    setLoading(personName);
    setCandidates(null);
    setPendingResearch(null);

    try {
      const { data, error } = await supabase.functions.invoke('research-person', {
        body: {
          person_name: personName,
          role,
          project_context: { ...projectContext, department },
          mode: 'assess',
          disambiguation_hint: `${candidate.descriptor} — known for: ${candidate.known_for}`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAssessments(prev => ({ ...prev, [personName]: data as PersonAssessment }));
    } catch (e) {
      console.error('Person research error:', e);
      toast.error('Could not assess this person right now.');
    } finally {
      setLoading(null);
    }
  };

  const clearDisambiguation = () => {
    setCandidates(null);
    setPendingResearch(null);
  };

  const clearAssessment = (personName: string) => {
    setAssessments(prev => {
      const next = { ...prev };
      delete next[personName];
      return next;
    });
  };

  return { research, loading, assessments, candidates, confirmCandidate, clearDisambiguation, clearAssessment };
}
