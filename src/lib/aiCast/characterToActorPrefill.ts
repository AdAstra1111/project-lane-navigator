/**
 * characterToActorPrefill — Phase 17: Bridge from project character truth
 * to actor creation prefill data.
 *
 * SINGLE SOURCE OF TRUTH for casting-native actor creation context.
 * Resolves character from canonical sources (canon_facts → project_images fallback).
 *
 * No LLM enrichment. Deterministic and truth-based only.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CharacterActorPrefill {
  project_id: string;
  character_key: string;
  display_name: string;
  suggested_actor_name: string;
  description: string;
  tags: string[];
  age_hint?: string | null;
  gender_hint?: string | null;
}

// ── Core Function ────────────────────────────────────────────────────────────

/**
 * Build prefill data for creating an AI actor from a project character.
 * Returns null if character cannot be resolved.
 */
export async function buildCharacterActorPrefill(
  projectId: string,
  characterKey: string,
): Promise<CharacterActorPrefill | null> {
  const normalizedKey = normalizeCharacterKey(characterKey);

  // 1. Try canon_facts for character data
  const { data: charTypeFacts } = await supabase
    .from('canon_facts')
    .select('subject')
    .eq('project_id', projectId)
    .eq('fact_type', 'character')
    .eq('is_active', true);

  const matchedSubject = (charTypeFacts || []).find(
    (f: any) => normalizeCharacterKey(f.subject) === normalizedKey,
  );

  if (matchedSubject) {
    const displayName = matchedSubject.subject;

    // Fetch all facts for this character subject
    const { data: allFacts } = await supabase
      .from('canon_facts')
      .select('predicate, object, value')
      .eq('project_id', projectId)
      .eq('subject', displayName)
      .eq('is_active', true);

    const facts = allFacts || [];
    const traits: string[] = [];
    let ageHint: string | null = null;
    let genderHint: string | null = null;
    const descParts: string[] = [];

    for (const fact of facts) {
      if (fact.predicate === 'age') {
        ageHint = fact.object;
        descParts.push(`Age: ${fact.object}`);
      } else if (fact.predicate === 'gender') {
        genderHint = fact.object;
        descParts.push(`Gender: ${fact.object}`);
      } else if (fact.predicate === 'description' || fact.predicate === 'appearance') {
        descParts.push(fact.object);
      } else if (fact.predicate === 'role') {
        descParts.push(`Role: ${fact.object}`);
      } else if (fact.predicate === 'character_trait') {
        traits.push(fact.object.toLowerCase());
        descParts.push(fact.object);
      } else if (fact.object) {
        traits.push(fact.object.toLowerCase());
      }
    }

    const tags = traits.filter(t => t.length > 2 && t.length < 30);
    const description = descParts.filter(Boolean).join('. ');

    return {
      project_id: projectId,
      character_key: normalizedKey,
      display_name: displayName,
      suggested_actor_name: displayName,
      description,
      tags,
      age_hint: ageHint,
      gender_hint: genderHint,
    };
  }

  // 2. Fallback: project_images subjects
  const { data: imageSubjects } = await (supabase as any)
    .from('project_images')
    .select('subject')
    .eq('project_id', projectId)
    .in('shot_type', ['identity_headshot', 'identity_full_body'])
    .not('subject', 'is', null);

  const matchedImage = (imageSubjects || []).find(
    (d: any) => normalizeCharacterKey(d.subject) === normalizedKey,
  );

  if (matchedImage) {
    return {
      project_id: projectId,
      character_key: normalizedKey,
      display_name: matchedImage.subject,
      suggested_actor_name: matchedImage.subject,
      description: '',
      tags: [],
      age_hint: null,
      gender_hint: null,
    };
  }

  // 3. Bare fallback: use the raw character key as the name
  return {
    project_id: projectId,
    character_key: normalizedKey,
    display_name: characterKey,
    suggested_actor_name: characterKey,
    description: '',
    tags: [],
    age_hint: null,
    gender_hint: null,
  };
}
