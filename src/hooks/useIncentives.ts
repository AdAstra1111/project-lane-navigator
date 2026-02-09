import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IncentiveProgram {
  id?: string;
  jurisdiction: string;
  name: string;
  type: string;
  headline_rate: string;
  qualifying_spend_rules: string;
  caps_limits: string;
  formats_supported: string[];
  payment_timing: string;
  stackability: string;
  eligibility_summary: string;
  source_url: string;
  confidence: string;
  notes: string;
  last_verified_at: string;
  status?: string;
}

export interface IncentiveSearchParams {
  jurisdiction: string;
  format?: string;
  budget_range?: string;
  genres?: string[];
}

export function useIncentiveResearch() {
  const [programs, setPrograms] = useState<IncentiveProgram[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const { toast } = useToast();

  const research = async (params: IncentiveSearchParams) => {
    setIsLoading(true);
    setSource(null);
    try {
      const { data, error } = await supabase.functions.invoke('research-incentives', {
        body: params,
      });

      if (error) throw error;

      if (data?.error) {
        toast({
          title: 'Research Error',
          description: data.error,
          variant: 'destructive',
        });
        return;
      }

      setPrograms(data.programs || []);
      setSource(data.source || 'unknown');
    } catch (err: any) {
      console.error('Incentive research error:', err);
      toast({
        title: 'Research Failed',
        description: err.message || 'Could not research incentives for this jurisdiction.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return { programs, isLoading, source, research };
}
