

# Fix: Working Set Not Reaching Build Path

## Root Cause

**React stale closure bug** in `LookBookPage.tsx`.

The Auto Complete handler does:
1. `setActiveWorkingSet(workingSet)` — queues state update (not yet committed)
2. `await handleGenerate()` — calls the build function

But `handleGenerate` reads `activeWorkingSet` from its closure (line 143), which is still `null` because React hasn't re-rendered yet. The 300ms `setTimeout` doesn't help — React state doesn't flush on arbitrary timers.

Both `handleAutoComplete` and `handleGenerate` are `useCallback` closures that capture the *old* `activeWorkingSet` value at the time they were created.

## Fix (Surgical — 2 changes)

### 1. Make `handleGenerate` accept an explicit working set parameter

Change the signature so Auto Complete can pass the working set directly, bypassing stale state:

```typescript
const handleGenerate = useCallback(async (explicitWorkingSet?: BuildWorkingSet | null) => {
  // Use explicit param first, then fall back to state
  const effectiveWorkingSet = explicitWorkingSet !== undefined 
    ? explicitWorkingSet 
    : activeWorkingSet;
  
  // Log proof
  console.log('[LookBookPage] handleGenerate called', {
    explicitWSProvided: explicitWorkingSet !== undefined,
    effectiveWSEntries: effectiveWorkingSet?.entries?.length ?? 0,
  });
  
  // Pass effectiveWorkingSet into generateLookBookData
  const freshData = await generateLookBookData(projectId, {
    ...branding options...,
    workingSet: effectiveWorkingSet,
  });
```

### 2. Pass working set directly in Auto Complete

Change the Auto Complete handler to pass the freshly built working set as an argument:

```typescript
// Instead of:
setActiveWorkingSet(workingSet);
await handleGenerate();

// Do:
setActiveWorkingSet(workingSet);  // still store for manual rebuilds
await handleGenerate(workingSet); // pass directly — no stale closure
```

### 3. Add diagnostic logs in `generateLookBookData`

At the working-set overlay entry point (~line 558), confirm receipt:

```typescript
console.log('[LookBook] workingSet received:', {
  hasWorkingSet: !!workingSet,
  entryCount: workingSet?.entries?.length ?? 0,
  slotKeys: workingSet ? Array.from(workingSet.bySlotKey.keys()) : [],
});
```

## Files Changed
- `src/pages/LookBookPage.tsx` — `handleGenerate` accepts optional param; `handleAutoComplete` passes it directly
- `src/lib/lookbook/generateLookBookData.ts` — add diagnostic log at working-set entry point

## What This Preserves
- Manual "Build Look Book" button still works (uses state-based `activeWorkingSet`)
- No canon promotion logic changed
- No architecture redesign
- All existing abilities intact

## Validation
After fix:
- Auto Complete → `handleGenerate(workingSet)` → `generateLookBookData` receives non-null working set → overrides apply → toast shows `> 0 images resolved`

