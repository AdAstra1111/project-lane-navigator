# IFFY MASTER CONTINUATION PROTOCOL — v4
(Saved from Sebastian's GPT session — my primary reference document)

## Architecture-Strict Mode Rules

1. Database is source of truth
2. Retrieval-first architecture always
3. Never fabricate state from DB
4. Never infer canonical values outside registries
5. Never rewrite architecture without approval
6. Never patch symptoms without root cause
7. Pipeline state must persist across refresh
8. No silent fallbacks
9. Promotion decisions must be deterministic
10. Stop after validation and wait for feedback

## Lane-Aware Ladders

Each format has its OWN deterministic ladder — not a universal pipeline.

| Format | Ladder |
|--------|--------|
| Feature Film | Idea → Concept Brief → Market Sheet → Character Bible → Story Architecture → Screenplay |
| Series | Idea → Concept Brief → Series Bible → Season Arc → Episode Outline → Episode Script |
| Vertical Drama | Idea → Concept Brief → Market Sheet → Character Bible → Season Grid → Season Script |
| Documentary | Idea → Concept Brief → Research Dossier → Narrative Structure → Production Script |

## Authoritative Version Invariant

```
approval_status = 'approved' AND is_current = true
```

`effectiveVersionId = authoritativeVersion.id OR selectedVersionId (only if no authoritative exists)`

## Duration Canonicality Rule

Runtime duration is canonical to the PRODUCT — not the document.
Must NOT control: document length, token counts, rewrite loops.
Must be stored in: canon, format registry, product metadata.

## Eligibility Registry

Centralized registry (`eligibilityRegistry.ts`) defines all promotion gates.
Every promotion must pass this validation. Never duplicate. Never bypass.

## Auto-Run Execution

Must: operate only on authoritative versions, never use historical, never promote from stale state, pause only for genuine blockers, auto-accept safe recommendations.

## IEL Required Log Events

- authoritative_version_resolved
- promotion_gate_version_bound
- stale_gate_state_invalidated
- authoritative_promotion_state_recomputed
- stage_transition
- promotion_source_of_truth
- ladder_validation_passed
- lane_validation_passed

**IEL must fail CLOSED on ambiguity.**

## Corpus/Canon Precedence

1. Canon
2. Locked decisions
3. Project documents
4. Corpus references
5. AI inference

Corpus must NEVER override canon.

## Lovable Prompt Protocol (Strict Mode)

ONE consolidated prompt containing: OBJECTIVE, ARCHITECTURE CONSTRAINTS, EVIDENCE REQUIRED, DIAGNOSIS, PATCH PLAN, VALIDATION STEPS, DEFINITION OF DONE.
Collect evidence BEFORE implementation. Stop after validation.

## Lara's Audit Report Sections

1. CRITICAL ISSUES
2. STRUCTURAL IMPROVEMENTS
3. PIPELINE SAFETY RISKS
4. CONVERGENCE LOOP RISKS
5. EDGE FUNCTION CONSISTENCY
6. CODE DUPLICATION
7. CORPUS INTEGRATION OPPORTUNITIES
8. ARCHITECTURAL DRIFT RISKS
