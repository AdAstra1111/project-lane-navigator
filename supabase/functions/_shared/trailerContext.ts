/** 
 * Shared Trailer Context Builder — single source of truth for assembling
 * canon-pack-based context for trailer generation (used by ai-trailer-factory
 * AND trailer-cinematic-engine).
 */

export interface PackContextItem {
  document_id: string;
  version_id: string | null;
  role: string;
  sort_order: number;
  doc_type: string;
  title: string;
  plaintext: string;
  char_count: number;
}

export interface PackContextMeta {
  pack_id: string;
  primary_cap: number;
  supporting_cap: number;
  merged_cap: number;
  total_chars_before_cap: number;
  total_chars_after_cap: number;
  used: Array<{ document_id: string; version_id: string | null; role: string; doc_type: string; chars: number }>;
  dropped: Array<{ document_id: string; version_id: string | null; role: string; reason: string }>;
  total_chars: number;
}

export interface PackContext {
  pack: any;
  items: PackContextItem[];
  mergedText: string;
  primariesText: string;
  supportingText: string;
  /** SHA-256 hex hash of mergedText for auditability */
  contextHash: string;
  /** Metadata for auditing */
  contextMeta: PackContextMeta;
}

// ─── Caps (match ai-trailer-factory) ───
const PRIMARY_CAP = 12000;
const SUPPORTING_CAP = 6000;
const MERGED_CAP = 16000;
const MIN_CONTEXT_CHARS = 1500;

/**
 * Compile trailer context from a canon definition pack.
 * Validates pack ownership, loads items + plaintext, applies caps,
 * computes hash and metadata for audit.
 */
export async function compileTrailerContext(
  db: any,
  projectId: string,
  packId: string,
): Promise<PackContext> {
  // 1. Load pack and verify project ownership
  const { data: pack } = await db.from("trailer_definition_packs")
    .select("*").eq("id", packId).eq("project_id", projectId).single();
  if (!pack) throw new Error("Trailer definition pack not found or project mismatch");

  // 2. Load included items ordered by sort_order
  const { data: packItems } = await db.from("trailer_definition_pack_items")
    .select("*").eq("pack_id", packId).eq("include", true)
    .order("sort_order", { ascending: true });

  if (!packItems || packItems.length === 0) {
    throw new Error("Canon pack empty/insufficient: no included documents");
  }

  // 3. Sort: primaries first, then by sort_order
  const sorted = [...packItems].sort((a: any, b: any) => {
    if (a.role === "primary" && b.role !== "primary") return -1;
    if (a.role !== "primary" && b.role === "primary") return 1;
    return a.sort_order - b.sort_order;
  });

  // 4. Batch fetch documents
  const docIds = sorted.map((i: any) => i.document_id);
  const { data: docs } = await db.from("project_documents")
    .select("id, title, doc_type").in("id", docIds);
  const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

  // 5. Resolve version IDs (explicit or current)
  const needCurrent = sorted.filter((i: any) => !i.version_id).map((i: any) => i.document_id);

  const currentMap = new Map<string, string>();
  if (needCurrent.length > 0) {
    const { data: currentVers } = await db.from("project_document_versions")
      .select("id, document_id").in("document_id", needCurrent)
      .eq("is_current", true);
    for (const v of (currentVers || [])) {
      currentMap.set(v.document_id, v.id);
    }
    // Fallback for docs without is_current: use latest by version_number
    const stillMissing = needCurrent.filter(did => !currentMap.has(did));
    if (stillMissing.length > 0) {
      const { data: latestVers } = await db.from("project_document_versions")
        .select("id, document_id").in("document_id", stillMissing)
        .order("version_number", { ascending: false });
      for (const v of (latestVers || [])) {
        if (!currentMap.has(v.document_id)) currentMap.set(v.document_id, v.id);
      }
    }
  }

  // 6. Batch fetch all plaintext in one query
  const allVersionIds: string[] = [];
  for (const item of sorted) {
    const vid = item.version_id || currentMap.get(item.document_id);
    if (vid) allVersionIds.push(vid);
  }

  const versionContentMap = new Map<string, string>();
  if (allVersionIds.length > 0) {
    const { data: versions } = await db.from("project_document_versions")
      .select("id, plaintext").in("id", allVersionIds);
    for (const v of (versions || [])) {
      versionContentMap.set(v.id, (v.plaintext || "").toString());
    }
  }

  // 7. Build items array + track dropped
  const items: PackContextItem[] = [];
  const dropped: PackContextMeta["dropped"] = [];

  for (const item of sorted) {
    const doc = docMap.get(item.document_id);
    if (!doc) {
      dropped.push({ document_id: item.document_id, version_id: item.version_id, role: item.role, reason: "document_not_found" });
      continue;
    }
    const versionId = item.version_id || currentMap.get(item.document_id) || null;
    if (!versionId) {
      // Primary items MUST resolve
      if (item.role === "primary") {
        throw new Error(`Primary document "${doc.title}" (${item.document_id}) has no version to resolve — cannot proceed`);
      }
      dropped.push({ document_id: item.document_id, version_id: null, role: item.role, reason: "no_version_found" });
      continue;
    }
    const plaintext = versionContentMap.get(versionId) || "";
    if (plaintext.length === 0) {
      dropped.push({ document_id: item.document_id, version_id: versionId, role: item.role, reason: "empty_plaintext" });
      continue;
    }
    items.push({
      document_id: item.document_id,
      version_id: versionId,
      role: item.role,
      sort_order: item.sort_order,
      doc_type: doc.doc_type,
      title: doc.title,
      plaintext,
      char_count: plaintext.length,
    });
  }

  if (items.length === 0) {
    throw new Error("Canon pack empty/insufficient: all documents were dropped (no resolvable text)");
  }

  // 8. Apply caps
  const primaries = items.filter(i => i.role === "primary");
  const supporting = items.filter(i => i.role === "supporting");

  const primariesText = truncateItems(primaries, PRIMARY_CAP);
  const supportingText = truncateItems(supporting, SUPPORTING_CAP);
  const mergedText = truncateItems(items, MERGED_CAP);

  // 9. Validate minimum threshold
  if (mergedText.length < MIN_CONTEXT_CHARS) {
    throw new Error(`Canon pack empty/insufficient: merged context is ${mergedText.length} chars, minimum ${MIN_CONTEXT_CHARS} required`);
  }

  // 10. Compute hash
  const contextHash = await sha256(mergedText);

  // 11. Build audit metadata
  const totalCharsBefore = items.reduce((s, i) => s + i.char_count, 0);
  const contextMeta: PackContextMeta = {
    pack_id: packId,
    primary_cap: PRIMARY_CAP,
    supporting_cap: SUPPORTING_CAP,
    merged_cap: MERGED_CAP,
    total_chars_before_cap: totalCharsBefore,
    total_chars_after_cap: mergedText.length,
    total_chars: totalCharsBefore,
    used: items.map(i => ({
      document_id: i.document_id,
      version_id: i.version_id,
      role: i.role,
      doc_type: i.doc_type,
      chars: i.char_count,
    })),
    dropped,
  };

  return { pack, items, mergedText, primariesText, supportingText, contextHash, contextMeta };
}

// ─── Internal helpers ───

function truncateItems(itemList: PackContextItem[], cap: number): string {
  if (itemList.length === 0) return "";
  const totalChars = itemList.reduce((s, i) => s + i.char_count, 0);
  if (totalChars <= cap) {
    return itemList.map(i => `--- ${i.title} (${i.doc_type}, ${i.role}) ---\n${i.plaintext}`).join("\n\n");
  }
  const perDoc = Math.floor(cap / itemList.length);
  return itemList.map(i => {
    const text = i.plaintext.length > perDoc ? i.plaintext.slice(0, perDoc) + "\n[… truncated]" : i.plaintext;
    return `--- ${i.title} (${i.doc_type}, ${i.role}) ---\n${text}`;
  }).join("\n\n");
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}
