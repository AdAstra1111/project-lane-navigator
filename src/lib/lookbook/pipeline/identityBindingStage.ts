/**
 * identityBindingStage — Binds principal characters to stable visual references.
 *
 * INPUT: NarrativeEvidence (characters), project image inventory
 * OUTPUT: IdentityBindings
 * SIDE EFFECTS: none (pure function)
 *
 * Rules:
 * - Principal characters → must bind to identity anchors where available
 * - Recurring secondary characters → semi-bound (best-effort)
 * - Incidental/background humans → no identity binding required
 */
import type { CharacterEvidence } from './narrativeEvidence';

// ── Types ────────────────────────────────────────────────────────────────────

export type BindingStrength = 'locked' | 'anchored' | 'weak' | 'unbound';

export interface CharacterBinding {
  characterName: string;
  characterId?: string;
  importance: CharacterEvidence['importance'];
  /** Binding strength based on available identity anchors */
  strength: BindingStrength;
  /** Primary image URL if bound */
  primaryImageUrl?: string;
  /** Whether identity DNA exists for this character */
  hasDNA: boolean;
  /** Reason for binding state */
  reason: string;
}

export interface IdentityBindings {
  /** Principal characters with binding state */
  principals: CharacterBinding[];
  /** Secondary/recurring characters */
  secondary: CharacterBinding[];
  /** Incidental population policy */
  incidentalPolicy: 'allow_generic' | 'suppress';
  /** Summary metrics */
  metrics: {
    totalCharacters: number;
    boundCount: number;
    unboundPrincipals: number;
    unboundSecondary: number;
  };
}

// ── Stage Runner ─────────────────────────────────────────────────────────────

/**
 * Run identity binding for all characters in narrative evidence.
 * Pure function — binds based on available data, does not fetch from DB.
 */
export function runIdentityBindingStage(
  characters: CharacterEvidence[],
  characterImageMap: Map<string, string>,
  characterNameImageMap: Map<string, string>,
): IdentityBindings {
  const bindings: CharacterBinding[] = characters.map(ch => {
    const id = ch.id;
    const nameLower = ch.name.toLowerCase();
    const imageUrl = (id && characterImageMap.get(id)) || characterNameImageMap.get(nameLower);
    
    let strength: BindingStrength;
    let reason: string;

    if (ch.hasIdentityAnchors && imageUrl) {
      strength = 'locked';
      reason = 'Identity anchors + primary image available';
    } else if (imageUrl) {
      strength = 'anchored';
      reason = 'Image available but no formal identity lock';
    } else if (ch.hasIdentityAnchors) {
      strength = 'weak';
      reason = 'Identity data exists but no resolved image';
    } else {
      strength = 'unbound';
      reason = ch.importance === 'incidental' ? 'Incidental — no binding required' : 'No identity anchors or images';
    }

    return {
      characterName: ch.name,
      characterId: id,
      importance: ch.importance,
      strength,
      primaryImageUrl: imageUrl,
      hasDNA: ch.hasIdentityAnchors,
      reason,
    };
  });

  const principals = bindings.filter(b => b.importance === 'principal');
  const secondary = bindings.filter(b => b.importance === 'recurring');
  const boundCount = bindings.filter(b => b.strength === 'locked' || b.strength === 'anchored').length;
  const unboundPrincipals = principals.filter(b => b.strength === 'unbound' || b.strength === 'weak').length;
  const unboundSecondary = secondary.filter(b => b.strength === 'unbound' || b.strength === 'weak').length;

  // Log binding summary
  console.log(`[Pipeline:identity] ${bindings.length} characters: ${boundCount} bound, ${unboundPrincipals} unbound principals, ${unboundSecondary} unbound secondary`);
  for (const b of principals) {
    console.log(`[Pipeline:identity]   ${b.characterName}: ${b.strength} — ${b.reason}`);
  }

  return {
    principals,
    secondary,
    incidentalPolicy: 'allow_generic',
    metrics: {
      totalCharacters: bindings.length,
      boundCount,
      unboundPrincipals,
      unboundSecondary,
    },
  };
}
