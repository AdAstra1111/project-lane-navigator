

## Plan: Script Version Convergence Tracking Panel + Build Error Fixes

### Build Error Fixes (3 issues)

1. **`CrossProjectIntelligence.tsx` L112** — `packaging_mode` doesn't exist on `Project` type. Fix: cast to `any` or use optional chaining `(p as any).packaging_mode`.

2. **`SpineConfirmationPanel.tsx` L158/173/179** — Type errors from `narrative_spine_json` not in DB types and `NarrativeSpine` not assignable to `Json`. Fix: cast through `as any` on the update/insert calls.

3. **`supabase/functions/_shared/llm.ts`** — `Deno` not found. This is an edge function file; these TS errors are expected in the Vite build context but shouldn't block. Will add a `// @ts-nocheck` or a `declare const Deno` shim if it's actually imported by client code.

### New Feature: Script Version Convergence Panel

**Location**: New component `src/components/project/ScriptVersionConvergence.tsx`, rendered inside the `ScriptsTab` in `ProjectAttachmentTabs.tsx`.

**Data source**: Query `project_document_versions` by `document_id` (for script-type documents from `project_documents`), ordered by `version_number ASC`. Uses existing `supabase` client with `(supabase as any)` pattern already established in the codebase.

**Component structure**:

```text
┌─ ScriptVersionConvergence ─────────────────────────┐
│ [Select script document ▼]  [Upload New Version ↑]  │
│                                                      │
│ ── Convergence Progress ──────────────────────────── │
│ [████████░░] 72% toward Tier A                       │
│                                                      │
│ ▾ Version History (collapsible)                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ v3 — "Polish Draft"  Mar 8, 2026                 │ │
│ │ [Tier B] [CONSIDER] [Conf: 72%]                  │ │
│ │ CI +5 ↑  GP +3 ↑  Notes: 2 new, 1 resolved      │ │
│ ├──────────────────────────────────────────────────┤ │
│ │ v2 — "Second Draft"  Mar 5, 2026                 │ │
│ │ [Tier C] [DEVELOP] [Conf: 55%]                   │ │
│ │ CI +12 ↑  Notes: 3 carried, 2 new                │ │
│ ├──────────────────────────────────────────────────┤ │
│ │ v1 — "First Draft"  Mar 1, 2026                  │ │
│ │ [Tier D] [DEVELOP] [Conf: 40%]                   │ │
│ │ Notes: 5 new                                     │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ [Upload placeholder: "Coverage analysis running..."] │
└──────────────────────────────────────────────────────┘
```

**Key logic**:
- Filter `project_documents` where `doc_type` contains `'script'`
- For selected script doc, fetch all versions with `meta_json` fields
- Extract from `meta_json`: `draft_label`, `verdict`, `tier`, `producer_confidence`, `ci` score, `gp` score, `notes` array
- Score deltas: compare each version's CI/GP against previous version, show as `+N ↑` or `-N ↓` badges
- Note breakdown: compare `notes` arrays by `title` field between consecutive versions → categorize as `resolved` (in prev not in current), `carried` (in both), `new` (in current not in prev)
- Convergence progress bar: map tier to percentage (D=25%, C=50%, B=75%, A=100%)
- Upload button: opens `<input type="file" accept=".pdf,.fdx,.fountain">`, on select shows "Coverage analysis running..." placeholder with spinner

**Integration**: Add `<ScriptVersionConvergence projectId={projectId} />` below the existing scripts list in `ScriptsTab`.

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/project/ScriptVersionConvergence.tsx` | **Create** — new panel component |
| `src/components/project/ProjectAttachmentTabs.tsx` | **Edit** — import and render in ScriptsTab |
| `src/components/dashboard/CrossProjectIntelligence.tsx` | **Edit** — fix `packaging_mode` type error |
| `src/components/narrative/SpineConfirmationPanel.tsx` | **Edit** — fix type casting errors |

