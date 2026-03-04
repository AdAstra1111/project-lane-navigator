export { noteFingerprint, type FingerprintableNote } from './fingerprint';
export { extractDecisions, decisionKeyFromNote, decisionTextFromNote, type DecisionEntry } from './extractDecision';
export { inferTargetsFromNote, inferTargetsFromCanonIssue, type DecisionTargets } from './targets';
export { normalizeDecision, normalizeDecisionList, type UiDecision } from './normalizeDecision';
export { normalizeDecisionForUI, normalizeDecisionsForUI, normalizePendingDecisionForUI, normalizePendingDecisionsForUI, type UIDecision, type UIPendingDecision, type UIDecisionOption } from './normalizeDecisionUI';
