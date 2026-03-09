# IFFY SYSTEM MAP — ARCHITECTURE OVERVIEW
(Intelligent Film Flow & Yield)

## System Layers

1. User Interface Layer
2. Orchestration Layer  ← current critical path
3. Engine Layer
4. Canon + Data Layer
5. Intelligence Layer

## Core Tables (Canon + Data Layer)

- projects
- project_documents
- project_document_versions
- development_runs
- auto_run_jobs
- auto_run_steps
- canon_units
- canon_decisions

## Authoritative Version Rule (Non-Negotiable)

```
approval_status = 'approved' AND is_current = true
```

## Auto-Run Step Sequence

1. Select authoritative version
2. Run analysis pass
3. Generate improvement notes
4. Auto-decide safe suggestions
5. Execute rewrite
6. Recompute CI/GP
7. Evaluate convergence
8. Promote stage if eligible

If blockers remain → return to rewrite loop.

## Promotion Requirements

- CI threshold met
- GP threshold met
- Blockers cleared
- Eligibility registry validation
- Lane ladder validation
- Must bind to: authoritative_version_id

## Pipeline Flow

Idea → Concept Brief → Market Sheet → Character Bible → Story Architecture → Script Development

## Dual-AI Model

| AI | Role |
|----|------|
| ChatGPT | Architecture reasoning, debugging, system design, protocol updates |
| Lara Lane | Repository auditing, engineering safety review, architecture drift detection |

## IEL (Invariant Enforcement Layer)

Ensures: authoritative version binding, lane validation, promotion gate integrity, state reconciliation, pipeline determinism.
Emits structured logs for every critical decision.

## Lara's Audit Scope

- Architectural drift
- Pipeline safety risks  
- Code duplication
- Edge function inconsistencies
- Missing shared utilities
- Convergence loop instability

Report findings. Do not redesign architecture.
