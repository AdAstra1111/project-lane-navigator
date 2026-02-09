import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface CoproFramework {
  id?: string;
  name: string;
  type: string;
  eligible_countries: string[];
  min_share_pct: number | null;
  max_share_pct: number | null;
  cultural_requirements: string;
  notes: string;
  source_url: string;
  confidence: string;
  last_verified_at: string;
}

export function useCoproResearch() {
  const [frameworks, setFrameworks] = useState<CoproFramework[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const { toast } = useToast();

  const research = async (countries: string[], format?: string, budget_range?: string, genres?: string[]) => {
    setIsLoading(true);
    setSource(null);
    try {
      const { data, error } = await supabase.functions.invoke('research-copro', {
        body: { countries, format, budget_range, genres },
      });

      if (error) throw error;

      if (data?.error) {
        toast({ title: 'Research Error', description: data.error, variant: 'destructive' });
        return;
      }

      setFrameworks(data.frameworks || []);
      setSource(data.source || 'unknown');
    } catch (err: any) {
      console.error('Co-pro research error:', err);
      toast({
        title: 'Research Failed',
        description: err.message || 'Could not research co-production frameworks.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return { frameworks, isLoading, source, research };
}
