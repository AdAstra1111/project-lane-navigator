

## Script Canon: Lane-Based Primary Script Resolver

### Problem
In `vertical_drama`, the UI labels and logic reference `episode_script` as the primary script, but the actual content is a full-season continuous script. This causes semantic confusion in labels, episode grid operations, and dev engine lookups.

### Approach
1. Register `season_script` as a new canonical doc type across all registries (frontend + backend)
2. Create a central resolver that maps `assigned_lane` to the correct primary script type
3. Patch the `vertical_drama` doc flow to use `season_script` instead of `episode_script`
4. Guard episode handoff to prevent accidental `episode_script` creation in vertical_drama

No database migrations needed — `doc_type` is a text column; new values are additive.

### Changes by File

**New file:**
- `src/lib/scriptCanon.ts` — Two functions: `resolvePrimaryScriptDocType(lane)` and `primaryScriptLabel(lane)`

**Frontend registries (add `season_script` as known type):**

| File | Change |
|------|--------|
| `src/config/documentLadders.ts` | Add `season_script` to `BASE_DOC_TYPES`; replace `episode_script` with `season_script` in `vertical_drama` ladder |
| `src/lib/docFlowMap.ts` | In `VERTICAL_DRAMA_CONFIG`: change `ep_script` tab label to "Season Script", docTypes to `['season_script']`; update `primaryFlow` and `series_writer` docTypes |
| `src/lib/stages/registry.ts` | Add `season_script` to `StageDocType` union and `DOC_KEY_MAP` |
| `src/lib/active-folder/normalizeDocTypeKey.ts` | Add `season_script` to type union, label map, and key map |
| `src/lib/backfillLabels.ts` | Add `season_script: 'Season Script'` label; add to script items filter |
| `src/lib/can-promote-to-script.ts` | Add `'season_script'` to `SCRIPT_TYPES` set and label map |
| `src/lib/coverage/types.ts` | Add `season_script` to role union and label map |
| `src/lib/coverage/bundles.ts` | For vertical_drama, use `season_script` instead of `episode_script` in bundle roles |

**Frontend UI patches (labels + doc type references):**

| File | Change |
|------|--------|
| `src/components/devengine/ActionToolbar.tsx` | Already includes `season_script` in script check — no change needed |
| `src/components/devengine/SceneGraphPanel.tsx` | Add `season_script` to script doc search |
| `src/components/devengine/StyleSourcesPanel.tsx` | Add `season_script` to `SCRIPT_DOC_TYPES` |
| `src/components/notes/ContextCards.tsx` | Add `season_script: 'Season Script'` label |
| `src/components/trailer/cinematic/CanonPackManager.tsx` | Add `season_script: 'Season Script'` label |
| `src/pages/ProjectDetail.tsx` | Add `season_script` to script doc search fallback |
| `src/hooks/useEpisodeHandoff.ts` | Add lane guard: if vertical_drama, use `season_script` as doc_type instead of `episode_script` |

**Backend edge functions (register `season_script`):**

| File | Change |
|------|--------|
| `supabase/functions/_shared/documentLadders.ts` | Add `season_script` to `BASE_DOC_TYPES` and `vertical_drama` ladder (mirror frontend) |
| `supabase/functions/_shared/stage-ladders.ts` | Add `season_script` mapping |
| `supabase/functions/auto-run/index.ts` | Add `season_script: 2000` to char thresholds; add to vertical_drama ladder references; add to `KEY_MAP_LOCAL` |
| `supabase/functions/coverage-engine/index.ts` | Add `season_script` to role maps and bundle roles |
| `supabase/functions/decisions-engine/index.ts` | Add `season_script` alongside `episode_script` in structural/pacing/hook targets |
| `supabase/functions/export-package/index.ts` | Replace `episode_script` with `season_script` in vertical-drama export ladder |
| `supabase/functions/visual-unit-engine/index.ts` | Add `season_script` to `DOC_TYPE_PRIORITY` |

### What does NOT change
- No database migrations
- No CORS / auth / userId threading
- No seed-pack flow changes
- `series` lane behavior is completely untouched (still uses `episode_script`)
- `feature_film` and other lanes continue using `feature_script`
- Canon (continuity) system unchanged
- No double `req.json()` introduced

### Estimated scope
~20 files modified, 1 new file created. All changes are additive type registrations + one conditional resolver.

