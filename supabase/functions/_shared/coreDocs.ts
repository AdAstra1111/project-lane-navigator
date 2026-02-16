/**
 * Shared Core Docs Fetcher — single canonical helper used by all generation endpoints.
 * Fetches the authoritative latest versions of essential project documents.
 */

export interface CoreDocs {
  characterBible: string;
  characterBibleVersionId: string | null;
  formatRules: string;
  formatRulesVersionId: string | null;
  seasonArc: string;
  seasonArcVersionId: string | null;
  episodeGrid: string;
  episodeGridVersionId: string | null;
  blueprint: string;
  blueprintVersionId: string | null;
}

const CORE_DOC_TYPES = [
  'character_bible',
  'format_rules',
  'season_arc',
  'episode_grid',
  'blueprint',
] as const;

/**
 * Fetch latest versions of all core project documents.
 * Uses project_documents + project_document_versions for consistent data.
 * @param supabase - service-role Supabase client
 * @param projectId - project UUID
 * @param overrides - optional map of doc_type -> specific version_id to use instead of latest
 */
export async function fetchCoreDocs(
  supabase: any,
  projectId: string,
  overrides?: Partial<Record<string, string>>
): Promise<CoreDocs> {
  const result: CoreDocs = {
    characterBible: '',
    characterBibleVersionId: null,
    formatRules: '',
    formatRulesVersionId: null,
    seasonArc: '',
    seasonArcVersionId: null,
    episodeGrid: '',
    episodeGridVersionId: null,
    blueprint: '',
    blueprintVersionId: null,
  };

  // Fetch all core doc records for this project in one query
  const { data: docs } = await supabase
    .from('project_documents')
    .select('id, doc_type')
    .eq('project_id', projectId)
    .in('doc_type', [...CORE_DOC_TYPES])
    .order('created_at', { ascending: false });

  if (!docs?.length) return result;

  // Deduplicate: keep only first (latest) per doc_type
  const latestByType: Record<string, string> = {};
  for (const doc of docs) {
    if (!latestByType[doc.doc_type]) {
      latestByType[doc.doc_type] = doc.id;
    }
  }

  // Fetch content for each doc type
  const fetchPromises = Object.entries(latestByType).map(async ([docType, docId]) => {
    const overrideVersionId = overrides?.[docType];

    let versionData: any;
    if (overrideVersionId) {
      // Use specific version
      const { data } = await supabase
        .from('project_document_versions')
        .select('id, content, plaintext')
        .eq('id', overrideVersionId)
        .maybeSingle();
      versionData = data;
    } else {
      // Use latest version
      const { data } = await supabase
        .from('project_document_versions')
        .select('id, content, plaintext')
        .eq('document_id', docId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      versionData = data;
    }

    if (!versionData) return;

    const content = versionData.content || versionData.plaintext || '';
    const versionId = versionData.id;

    switch (docType) {
      case 'character_bible':
        result.characterBible = content;
        result.characterBibleVersionId = versionId;
        break;
      case 'format_rules':
        result.formatRules = content;
        result.formatRulesVersionId = versionId;
        break;
      case 'season_arc':
        result.seasonArc = content;
        result.seasonArcVersionId = versionId;
        break;
      case 'episode_grid':
        result.episodeGrid = content;
        result.episodeGridVersionId = versionId;
        break;
      case 'blueprint':
        result.blueprint = content;
        result.blueprintVersionId = versionId;
        break;
    }
  });

  await Promise.all(fetchPromises);
  return result;
}

// ─── Generic Extras Allowlist ───
const GENERIC_EXTRAS = new Set([
  'WAITER', 'WAITRESS', 'GUARD', 'SECURITY GUARD', 'DRIVER', 'PASSERBY',
  'CROWD', 'NURSE', 'DOCTOR', 'CLERK', 'BARTENDER', 'SERVER', 'RECEPTIONIST',
  'OFFICER', 'COP', 'POLICE OFFICER', 'DELIVERY PERSON', 'COURIER',
  'STRANGER', 'BYSTANDER', 'HOST', 'HOSTESS', 'DOORMAN', 'BOUNCER',
  'VENDOR', 'CUSTOMER', 'PATRON', 'ANNOUNCER', 'ANCHOR', 'REPORTER',
  'INTERVIEWER', 'MAN', 'WOMAN', 'BOY', 'GIRL', 'KID', 'CHILD',
  'OLD MAN', 'OLD WOMAN', 'YOUNG MAN', 'YOUNG WOMAN', 'TEENAGER',
  'VOICE', 'V.O.', 'O.S.', 'NARRATOR', 'SUPER', 'TITLE', 'CHYRON',
  'NEWS ANCHOR', 'PEDESTRIAN', 'CASHIER', 'MANAGER', 'BOSS',
  'NEIGHBOR', 'FRIEND', 'STUDENT', 'TEACHER', 'PROFESSOR',
]);

/**
 * Extract character cue names from screenplay text.
 * Matches uppercase names that appear as character cues (typically centered/indented names above dialogue).
 */
export function extractCharacterCues(scriptText: string): string[] {
  const cues = new Set<string>();
  // Match <center>NAME</center> format
  const centerMatches = scriptText.matchAll(/<center>\s*([A-Z][A-Z\s.']+?)\s*<\/center>/g);
  for (const m of centerMatches) {
    let name = m[1].trim();
    // Strip V.O., O.S., CONT'D etc.
    name = name.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\(V\.O\.\)\s*/g, '').replace(/\s*\(O\.S\.\)\s*/g, '').trim();
    if (name) cues.add(name);
  }
  // Also match standard screenplay format: lines that are all-caps on their own
  const lines = scriptText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Character cue: all uppercase, 2-30 chars, possibly with (V.O.) etc.
    if (/^[A-Z][A-Z\s.'-]{1,29}(\s*\(.*?\))?\s*$/.test(trimmed) && !trimmed.startsWith('INT.') && !trimmed.startsWith('EXT.') && !trimmed.startsWith('INT/EXT.')) {
      let name = trimmed.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (name.length >= 2 && name.length <= 25 && !name.includes('SCENE') && !name.includes('FADE') && !name.includes('CUT TO') && !name.includes('END')) {
        cues.add(name);
      }
    }
  }
  return [...cues];
}

/**
 * Extract allowed character names from a character bible text.
 * Looks for character names in various formats.
 */
export function extractBibleCharacters(characterBible: string): Set<string> {
  const names = new Set<string>();
  if (!characterBible) return names;

  // Match patterns like \"NAME (age, description)\" or \"**NAME**\" or \"NAME:\" or uppercase-only lines
  const patterns = [
    /\*\*([A-Z][A-Za-z\s'-]+?)\*\*/g,           // **NAME**
    /^#+\s*([A-Z][A-Za-z\s'-]+)/gm,              // # NAME or ## NAME
    /^([A-Z][A-Z\s'-]{1,25})\s*[(\-–:]/gm,       // NAME (age) or NAME - desc or NAME:
    /(?:^|\n)([A-Z][A-Z\s'-]{1,25})\s*$/gm,      // Standalone uppercase name
  ];

  for (const pattern of patterns) {
    const matches = characterBible.matchAll(pattern);
    for (const m of matches) {
      const name = m[1].trim();
      if (name.length >= 2 && name.length <= 25) {
        names.add(name.toUpperCase());
        // Also add first name only
        const firstName = name.split(/[\s-]/)[0];
        if (firstName.length >= 2) names.add(firstName.toUpperCase());
      }
    }
  }
  return names;
}

export interface CharacterValidationResult {
  passed: boolean;
  inventedCharacters: string[];
  allowedCharacters: string[];
}

/**
 * Validate that all character cues in a script appear in the character bible.
 * Returns invented characters that violate the bible constraint.
 */
export function validateCharacterCues(
  scriptText: string,
  characterBible: string
): CharacterValidationResult {
  const cues = extractCharacterCues(scriptText);
  const bibleNames = extractBibleCharacters(characterBible);
  const allowed = [...bibleNames];

  const inventedCharacters: string[] = [];
  for (const cue of cues) {
    const upper = cue.toUpperCase();
    if (GENERIC_EXTRAS.has(upper)) continue;
    if (bibleNames.has(upper)) continue;
    // Check partial matches (first name match)
    const firstName = upper.split(/[\s-]/)[0];
    if (bibleNames.has(firstName)) continue;
    // Check if any bible name contains this cue or vice versa
    let found = false;
    for (const bn of bibleNames) {
      if (bn.includes(upper) || upper.includes(bn)) {
        found = true;
        break;
      }
    }
    if (!found) inventedCharacters.push(cue);
  }

  return {
    passed: inventedCharacters.length === 0,
    inventedCharacters,
    allowedCharacters: allowed,
  };
}
