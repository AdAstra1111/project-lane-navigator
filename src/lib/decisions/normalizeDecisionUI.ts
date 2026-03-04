export interface UIDecisionOption {
  option_id: string;
  title: string;
  what_changes: string[];
  tradeoffs?: string;
  creative_tradeoff?: string;
  creative_risk?: 'low' | 'med' | 'high';
  commercial_lift: number;
}

export interface UIDecision {
  note_id: string;
  severity: string;
  note: string;
  options: UIDecisionOption[];
  recommended_option_id?: string;
  recommended?: string;
  selectedOptions: unknown[];
  reasons: unknown[];
  blockers: unknown[];
  impacts: unknown[];
  decision_key?: string;
  source?: string;
  malformed?: boolean;
  missing_fields?: string[];
}

export interface UIPendingDecision {
  id: string;
  question: string;
  options: Array<{ value: string; why: string }>;
  recommended?: string;
  impact: 'blocking' | 'non_blocking';
  decision_key?: string;
  source?: string;
  malformed?: boolean;
  missing_fields?: string[];
}

const toArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? value : []);

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function logMalformed(source: string, decisionKey: string, missingFields: string[]) {
  if (missingFields.length === 0) return;
  console.warn('[decisions][IEL] malformed_payload', {
    source,
    decision_key: decisionKey,
    missing_fields: missingFields,
  });
}

function normalizeDecisionOption(raw: any): UIDecisionOption {
  const optionId = asString(raw?.option_id) || asString(raw?.value) || asString(raw?.id) || 'unknown_option';
  const title = asString(raw?.title) || asString(raw?.label) || asString(raw?.value) || optionId;
  const whatChanges = Array.isArray(raw?.what_changes)
    ? raw.what_changes.map((x: any) => String(x)).filter(Boolean)
    : (raw?.why ? [String(raw.why)] : []);

  return {
    option_id: optionId,
    title,
    what_changes: whatChanges,
    tradeoffs: raw?.tradeoffs ? String(raw.tradeoffs) : undefined,
    creative_tradeoff: raw?.creative_tradeoff ? String(raw.creative_tradeoff) : undefined,
    creative_risk: raw?.creative_risk,
    commercial_lift: Number.isFinite(raw?.commercial_lift) ? Number(raw.commercial_lift) : 0,
  };
}

export function normalizeDecisionForUI(raw: any, source: string): UIDecision {
  const decisionKey = asString(raw?.decision_key) || asString(raw?.note_id) || asString(raw?.id) || 'unknown_decision';
  const options = toArray(raw?.options).map(normalizeDecisionOption);

  const missingFields: string[] = [];
  if (!Array.isArray(raw?.options)) missingFields.push('options');
  if (!raw?.note_id && !raw?.id && !raw?.decision_key) missingFields.push('note_id');
  if (!raw?.note && !raw?.question && !raw?.title && !raw?.decision_text) missingFields.push('note');

  logMalformed(source, decisionKey, missingFields);

  const normalized: UIDecision = {
    note_id: asString(raw?.note_id) || asString(raw?.id) || decisionKey,
    severity: asString(raw?.severity) || (raw?.impact === 'blocking' ? 'blocker' : 'high'),
    note: asString(raw?.note) || asString(raw?.question) || asString(raw?.title) || asString(raw?.decision_text) || 'Decision required',
    options,
    recommended_option_id: asString(raw?.recommended_option_id) || undefined,
    recommended: asString(raw?.recommended) || asString(raw?.decision_value?.recommendation?.value) || undefined,
    selectedOptions: toArray(raw?.selectedOptions),
    reasons: toArray(raw?.reasons),
    blockers: toArray(raw?.blockers),
    impacts: toArray(raw?.impacts),
    decision_key: decisionKey,
    source,
    malformed: missingFields.length > 0,
    missing_fields: missingFields,
  };

  if (!normalized.recommended_option_id && normalized.recommended) {
    normalized.recommended_option_id = normalized.recommended;
  }

  return normalized;
}

export function normalizeDecisionsForUI(raw: any[], source: string): UIDecision[] {
  return toArray(raw).map((d) => normalizeDecisionForUI(d, source));
}

export function normalizePendingDecisionForUI(raw: any, source: string): UIPendingDecision {
  const decisionKey = asString(raw?.decision_key) || asString(raw?.id) || 'unknown_pending_decision';
  const optionsRaw = toArray(raw?.options).length > 0
    ? toArray(raw?.options)
    : toArray(raw?.decision_value?.options);

  const options = optionsRaw
    .map((o: any) => ({
      value: asString(o?.value) || asString(o?.option_id) || asString(o?.label) || 'unknown_option',
      why: asString(o?.why) || asString(o?.label) || asString(o?.reason) || '',
    }))
    .filter((o: any) => !!o.value);

  const impact = raw?.impact === 'blocking' || raw?.decision_value?.classification === 'BLOCKING_NOW'
    ? 'blocking'
    : 'non_blocking';

  const missingFields: string[] = [];
  if (!Array.isArray(raw?.options) && !Array.isArray(raw?.decision_value?.options)) missingFields.push('options');
  if (!raw?.question && !raw?.title && !raw?.decision_value?.question && !raw?.decision_text) missingFields.push('question');

  logMalformed(source, decisionKey, missingFields);

  return {
    id: asString(raw?.id) || decisionKey,
    question: asString(raw?.question) || asString(raw?.title) || asString(raw?.decision_value?.question) || asString(raw?.decision_text) || 'Decision required',
    options,
    recommended: asString(raw?.recommended) || asString(raw?.decision_value?.recommendation?.value) || undefined,
    impact,
    decision_key: decisionKey,
    source,
    malformed: missingFields.length > 0,
    missing_fields: missingFields,
  };
}

export function normalizePendingDecisionsForUI(raw: any[], source: string): UIPendingDecision[] {
  return toArray(raw).map((d) => normalizePendingDecisionForUI(d, source));
}
