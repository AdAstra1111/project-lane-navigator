

## Make Cast and Crew Names Clickable with Profile Pictures

### What Changes

Every person name in the Cast and HODs (Crew) lists on the project detail page will get:
1. A small circular avatar thumbnail (fetched from Wikipedia via the existing `usePersonImage` hook)
2. A clickable name that opens the existing `CastInfoDialog` for a full profile view with photos, market assessment, and external links

### Technical Approach

**Create a reusable `PersonNameLink` component** that encapsulates the avatar + clickable name + dialog trigger pattern. This avoids duplicating state/dialog logic across Cast and HODs tabs.

The component will:
- Accept `personName`, `reason` (context string for the dialog), and `projectContext`
- Use the existing `usePersonImage` hook for the avatar thumbnail
- Render a small `Avatar` with `AvatarImage` / `AvatarFallback` (using the existing Radix avatar component)
- On click, open the existing `CastInfoDialog`
- Manage its own open/close state internally

**Files to create:**
- `src/components/PersonNameLink.tsx` -- small reusable component (~40 lines)

**Files to modify:**
- `src/components/ProjectAttachmentTabs.tsx` -- two changes:
  1. **CastTab** (around line 112): Replace the plain `<span>{c.actor_name}</span>` with `<PersonNameLink>`, passing `personName={c.actor_name}`, `reason={c.role_name}`, and `projectContext`
  2. **HODsTab** (around line 680): Replace the plain `<span>{h.person_name}</span>` with `<PersonNameLink>`, passing `personName={h.person_name}`, `reason={h.department + ' · ' + h.known_for}`, and `projectContext`

### Visual Result

Before:
```text
[Greta Lee] as ELEANOR        Wishlist  [trash]
```

After:
```text
[photo] Greta Lee  as ELEANOR   Wishlist  [trash]
 ^^^^^  ^^^^^^^^^
 avatar  clickable -- opens full profile dialog
```

The avatar will be 24x24px (`h-6 w-6`), showing a `User` icon fallback when no Wikipedia image is found. Clicking the name opens the same rich `CastInfoDialog` already used in the Talent Triage board.

### Implementation Details

- Reuses `usePersonImage` (Wikipedia thumbnail cache) for avatars -- no new API calls
- Reuses `CastInfoDialog` for the detail view -- no new dialog code
- The `TalentTriageBoard` already has this pattern working; this simply brings it to the attachment lists
- Partners tab names are company names (not people), so they will not get this treatment

