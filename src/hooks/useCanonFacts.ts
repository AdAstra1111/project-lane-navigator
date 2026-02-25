/**
 * useCanonFacts — CRUD hook for managing canon facts through the Canon Editor storage.
 * 
 * All mutations operate on the project_canon.canon_json via useProjectCanon.
 */
import { useCallback, useMemo } from 'react';
import { useProjectCanon, type CanonJson, type CanonCharacter } from '@/hooks/useProjectCanon';
import { useCanonicalState } from '@/hooks/useCanonicalState';
import { normalizeCanonFacts, type CanonFact, type CanonCategory } from '@/lib/canon/normalizeCanonFacts';
import { toast } from 'sonner';

// Maps category -> canon_json field key
const CATEGORY_TO_FIELD: Record<CanonCategory, string> = {
  logline: 'logline',
  premise: 'premise',
  character: 'characters',
  world_rule: 'world_rules',
  timeline: 'timeline',
  location: 'locations',
  tone_style: 'tone_style',
  format_constraint: 'format_constraints',
  ongoing_thread: 'ongoing_threads',
  forbidden_change: 'forbidden_changes',
  other: '',
};

// Categories that store multiple items as newline-separated text
const MULTI_LINE_CATEGORIES: CanonCategory[] = [
  'world_rule', 'location', 'ongoing_thread', 'forbidden_change',
];

function getLines(canon: CanonJson, field: string): string[] {
  const val = canon[field];
  if (typeof val !== 'string') return [];
  return val.split('\n').map(l => l.trim()).filter(Boolean);
}

function setLines(lines: string[]): string {
  return lines.join('\n');
}

export function useCanonFacts(projectId: string | undefined) {
  const {
    canon, save, saveAsync, isSaving, isLoading: isCanonLoading,
  } = useProjectCanon(projectId);

  const {
    canonState, source, sourceLabel, evidence,
    isLoading: isStateLoading, refetch,
  } = useCanonicalState(projectId);

  const facts = useMemo(() => normalizeCanonFacts(canonState), [canonState]);

  const addFact = useCallback(async (category: CanonCategory, text: string) => {
    const field = CATEGORY_TO_FIELD[category];
    if (!field || category === 'other') {
      toast.error('Cannot add facts of type "other" directly');
      return;
    }

    const patch: Partial<CanonJson> = {};

    if (category === 'character') {
      const chars: CanonCharacter[] = [...(canon.characters || [])];
      chars.push({ name: text, role: '', goals: '', traits: '', secrets: '', relationships: '' });
      patch.characters = chars;
    } else if (MULTI_LINE_CATEGORIES.includes(category)) {
      const lines = getLines(canon, field);
      lines.push(text);
      patch[field] = setLines(lines);
    } else {
      // Single value fields (logline, premise, etc.)
      patch[field] = text;
    }

    await saveAsync(patch);
    refetch();
    toast.success('Canon fact added');
  }, [canon, saveAsync, refetch]);

  const updateFact = useCallback(async (factId: string, newText: string, characterData?: CanonCharacter) => {
    const fact = facts.find(f => f.id === factId);
    if (!fact) return;
    if (fact.source !== 'canon_editor') {
      toast.error('Only Canon Editor facts can be edited directly');
      return;
    }

    const field = CATEGORY_TO_FIELD[fact.category];
    if (!field) return;

    const patch: Partial<CanonJson> = {};

    if (fact.category === 'character' && fact.evidence.index !== undefined) {
      const chars = [...(canon.characters || [])];
      if (characterData) {
        chars[fact.evidence.index] = characterData;
      } else {
        // Just update name from text
        chars[fact.evidence.index] = { ...chars[fact.evidence.index], name: newText };
      }
      patch.characters = chars;
    } else if (MULTI_LINE_CATEGORIES.includes(fact.category) && fact.evidence.index !== undefined) {
      const lines = getLines(canon, field);
      lines[fact.evidence.index] = newText;
      patch[field] = setLines(lines);
    } else {
      patch[field] = newText;
    }

    await saveAsync(patch);
    refetch();
    toast.success('Canon fact updated');
  }, [facts, canon, saveAsync, refetch]);

  const deleteFact = useCallback(async (factId: string) => {
    const fact = facts.find(f => f.id === factId);
    if (!fact) return;
    if (fact.source !== 'canon_editor') {
      toast.error('Only Canon Editor facts can be deleted');
      return;
    }

    const field = CATEGORY_TO_FIELD[fact.category];
    if (!field) return;

    const patch: Partial<CanonJson> = {};

    if (fact.category === 'character' && fact.evidence.index !== undefined) {
      const chars = [...(canon.characters || [])];
      chars.splice(fact.evidence.index, 1);
      patch.characters = chars;
    } else if (MULTI_LINE_CATEGORIES.includes(fact.category) && fact.evidence.index !== undefined) {
      const lines = getLines(canon, field);
      lines.splice(fact.evidence.index, 1);
      patch[field] = setLines(lines);
    } else {
      patch[field] = '';
    }

    await saveAsync(patch);
    refetch();
    toast.success('Canon fact deleted');
  }, [facts, canon, saveAsync, refetch]);

  const lockFact = useCallback(async (factId: string) => {
    const fact = facts.find(f => f.id === factId);
    if (!fact) return;

    const lines = getLines(canon, 'forbidden_changes');
    const lockText = `[${fact.category}] ${fact.text}`;
    if (!lines.includes(lockText)) {
      lines.push(lockText);
      await saveAsync({ forbidden_changes: setLines(lines) });
      refetch();
      toast.success('Fact locked — added to Forbidden Changes');
    }
  }, [facts, canon, saveAsync, refetch]);

  const unlockFact = useCallback(async (factId: string) => {
    const fact = facts.find(f => f.id === factId);
    if (!fact) return;

    if (fact.category === 'forbidden_change' && fact.evidence.index !== undefined) {
      const lines = getLines(canon, 'forbidden_changes');
      lines.splice(fact.evidence.index, 1);
      await saveAsync({ forbidden_changes: setLines(lines) });
      refetch();
      toast.success('Fact unlocked — removed from Forbidden Changes');
    }
  }, [facts, canon, saveAsync, refetch]);

  const promoteFact = useCallback(async (fact: CanonFact) => {
    if (fact.source === 'canon_editor') return;
    // Write into canon editor
    await addFact(fact.category === 'other' ? 'logline' : fact.category, fact.text);
    toast.success('Fact promoted to Canon Editor');
  }, [addFact]);

  return {
    facts,
    source,
    sourceLabel,
    evidence,
    isLoading: isCanonLoading || isStateLoading,
    isSaving,
    addFact,
    updateFact,
    deleteFact,
    lockFact,
    unlockFact,
    promoteFact,
    refetch,
  };
}
