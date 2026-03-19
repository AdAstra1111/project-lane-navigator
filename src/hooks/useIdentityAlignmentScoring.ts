/**
 * useIdentityAlignmentScoring — Hook that computes deterministic identity
 * alignment scores for a character's candidate images across all 3 identity slots.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  computeCharacterAlignment,
  type CharacterAlignmentResult,
  type IdentitySlot,
} from '@/lib/images/identityAlignmentScoring';
import type { CharacterVisualDNA } from '@/lib/images/visualDNA';
import type { ProjectImage } from '@/lib/images/types';
import type { ImageEvaluation } from '@/lib/images/imageEvaluation';

export function useIdentityAlignmentScoring(
  projectId: string | undefined,
  characterName: string | undefined,
  identityImages: ProjectImage[],
  dna: CharacterVisualDNA | null,
  dnaRecord: Record<string, unknown> | null,
) {
  // Fetch evaluations for identity images
  const imageIds = identityImages.map(i => i.id);
  
  const { data: evaluationsRaw } = useQuery({
    queryKey: ['identity-evaluations', projectId, characterName, imageIds.join(',')],
    queryFn: async () => {
      if (!projectId || imageIds.length === 0) return [];
      const { data } = await (supabase as any)
        .from('image_evaluations')
        .select('*')
        .eq('project_id', projectId)
        .in('image_id', imageIds)
        .order('created_at', { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!projectId && imageIds.length > 0,
    staleTime: 60_000,
  });

  // Build evaluation map (latest per image)
  const evaluationMap = useMemo(() => {
    const map = new Map<string, ImageEvaluation>();
    if (!evaluationsRaw) return map;
    for (const ev of evaluationsRaw) {
      if (!map.has(ev.image_id)) {
        map.set(ev.image_id, ev as unknown as ImageEvaluation);
      }
    }
    return map;
  }, [evaluationsRaw]);

  // Current primaries
  const currentPrimaries = useMemo(
    () => identityImages.filter(i => i.is_primary),
    [identityImages],
  );

  // Raw identity_signature from DB record
  const rawSignature = (dnaRecord as any)?.identity_signature || null;

  // Compute alignment (deterministic, pure)
  const alignment: CharacterAlignmentResult | null = useMemo(() => {
    if (!characterName || identityImages.length === 0) return null;
    return computeCharacterAlignment(
      characterName,
      identityImages,
      dna,
      rawSignature,
      currentPrimaries,
      evaluationMap,
    );
  }, [characterName, identityImages, dna, rawSignature, currentPrimaries, evaluationMap]);

  return {
    alignment,
    evaluationMap,
  };
}
