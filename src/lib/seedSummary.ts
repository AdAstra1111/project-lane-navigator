/**
 * Deterministic Seed Summary builder.
 * Reads current-version plaintext from the five seed docs and extracts
 * a concise summary using regex/section parsing. NO LLM calls.
 */
import { supabase } from '@/integrations/supabase/client';

const SEED_DOC_TYPES = ['project_overview', 'creative_brief', 'market_positioning', 'canon', 'nec'] as const;

export interface SeedSummary {
  overview: string;
  briefBullets: string[];
  compsBullets: string[];
  necSummary: string;
  canonHighlights: string;
  isEmpty: boolean;
}

/** Extract a section between a heading and the next heading */
function extractSection(text: string, headingPattern: RegExp): string {
  const match = text.match(headingPattern);
  if (!match) return '';
  const startIdx = match.index! + match[0].length;
  const rest = text.slice(startIdx);
  const nextHeading = rest.match(/\n(?:#{1,3}\s|[*]{2}[A-Z])/);
  const section = nextHeading ? rest.slice(0, nextHeading.index!) : rest;
  return section.trim();
}

/** Extract bullet items from a section */
function extractBullets(section: string, max = 5): string[] {
  return section
    .split('\n')
    .map(l => l.replace(/^[-•*]\s*/, '').trim())
    .filter(l => l.length > 3 && l.length < 200)
    .slice(0, max);
}

/** Build seed summary deterministically from plaintext */
export async function buildSeedSummary(projectId: string): Promise<SeedSummary> {
  const empty: SeedSummary = { overview: '', briefBullets: [], compsBullets: [], necSummary: '', canonHighlights: '', isEmpty: true };

  // Fetch seed docs
  const { data: docs } = await (supabase as any)
    .from('project_documents')
    .select('id, doc_type')
    .eq('project_id', projectId)
    .in('doc_type', [...SEED_DOC_TYPES]);

  if (!docs || docs.length === 0) return empty;

  const docIds = docs.map((d: any) => d.id);
  const { data: versions } = await (supabase as any)
    .from('project_document_versions')
    .select('document_id, plaintext')
    .in('document_id', docIds)
    .eq('is_current', true);

  if (!versions || versions.length === 0) return empty;

  const textByType: Record<string, string> = {};
  for (const doc of docs) {
    const ver = versions.find((v: any) => v.document_id === doc.id);
    if (ver?.plaintext) textByType[doc.doc_type] = ver.plaintext;
  }

  const result: SeedSummary = { overview: '', briefBullets: [], compsBullets: [], necSummary: '', canonHighlights: '', isEmpty: true };

  // Project Overview — first 200 chars
  if (textByType.project_overview) {
    const text = textByType.project_overview.trim();
    result.overview = text.length > 200 ? text.slice(0, 200) + '…' : text;
  }

  // Creative Brief — extract key sections
  if (textByType.creative_brief) {
    const text = textByType.creative_brief;
    const tone = extractSection(text, /(?:#{1,3}\s*)?(?:Tone|Voice|Style)/i);
    const premise = extractSection(text, /(?:#{1,3}\s*)?(?:Premise|Synopsis|Summary)/i);
    const logline = extractSection(text, /(?:#{1,3}\s*)?(?:Logline|Log\s*Line)/i);
    const bullets: string[] = [];
    if (logline) bullets.push(`Logline: ${logline.split('\n')[0]?.trim().slice(0, 150)}`);
    if (premise) bullets.push(`Premise: ${premise.split('\n')[0]?.trim().slice(0, 150)}`);
    if (tone) bullets.push(`Tone: ${tone.split('\n')[0]?.trim().slice(0, 100)}`);
    result.briefBullets = bullets.slice(0, 5);
  }

  // Market Positioning — comparables
  if (textByType.market_positioning) {
    const text = textByType.market_positioning;
    const compSection = extractSection(text, /(?:#{1,3}\s*)?(?:Comparable|Comp|Reference)\s*(?:Titles?|Projects?|Works?)/i);
    if (compSection) {
      result.compsBullets = extractBullets(compSection, 5);
    }
  }

  // NEC — extract tier info
  if (textByType.nec) {
    const text = textByType.nec;
    const tierMatch = text.match(/(?:preferred|operating)\s*(?:tier|level)[:\s]*(\d)/i);
    const maxTierMatch = text.match(/(?:absolute|max|maximum)\s*(?:tier|level)[:\s]*(\d)/i);
    const parts: string[] = [];
    if (tierMatch) parts.push(`Preferred Tier: ${tierMatch[1]}`);
    if (maxTierMatch) parts.push(`Max Tier: ${maxTierMatch[1]}`);
    if (parts.length === 0) {
      // Fallback: first 100 chars
      result.necSummary = text.trim().slice(0, 100);
    } else {
      result.necSummary = parts.join(' · ');
    }
  }

  // Canon — first 150 chars
  if (textByType.canon) {
    const text = textByType.canon;
    const rulesSection = extractSection(text, /(?:#{1,3}\s*)?(?:World\s*Rules?|Constraints?|Canon\s*Rules?|Mandatories)/i);
    result.canonHighlights = (rulesSection || text.trim()).slice(0, 150);
    if (result.canonHighlights.length >= 150) result.canonHighlights += '…';
  }

  result.isEmpty = !result.overview && result.briefBullets.length === 0 && result.compsBullets.length === 0 && !result.necSummary && !result.canonHighlights;

  return result;
}
