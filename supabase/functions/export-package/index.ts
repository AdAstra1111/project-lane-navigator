/**
 * export-package — Builds a ZIP or merged PDF of all deliverables for a project.
 * POST { projectId, scope, include_master_script, include_types?, expiresInSeconds?, output_format? }
 * output_format: "zip" (default) | "pdf"
 * Returns { signed_url, expires_at, storage_path, doc_count }
 *
 * scope: "approved_preferred" | "approved_only" | "latest_only"
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { STAGE_LADDERS } from "../_shared/stage-ladders.ts";
import JSZip from "npm:jszip@3";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Canonical ladder per format — imported from single source of truth
const FORMAT_LADDERS: Record<string, string[]> = STAGE_LADDERS.FORMAT_LADDERS;

function getLadder(format: string): string[] {
  const key = (format ?? '').trim().toLowerCase().replace(/[_ ]+/g, "-");
  if (!key) return [];
  return FORMAT_LADDERS[key] ?? [];
}

function toLabel(docType: string, format?: string): string {
  const LABELS: Record<string, string> = {
    idea: "Idea",
    topline_narrative: "Topline Narrative",
    concept_brief: "Concept Brief",
    market_sheet: "Market Sheet",
    vertical_market_sheet: "Market Sheet (VD)",
    blueprint: "Season Blueprint",
    architecture: "Series Architecture",
    character_bible: "Character Bible",
    beat_sheet: "Episode Beat Sheet",
    feature_script: "Feature Script",
    episode_script: "Episode Script",
    season_script: "Season Script",
    script: "Script",
    season_master_script: "Master Season Script",
    production_draft: "Production Draft",
    deck: "Deck",
    documentary_outline: "Documentary Outline",
    format_rules: "Format Rules",
    season_arc: "Season Arc",
    episode_grid: "Episode Grid",
    vertical_episode_beats: "Episode Beats",
    series_writer: "Series Writer",
  };
  const NON_SERIES = new Set(["film", "feature", "short", "documentary", "hybrid-documentary", "short-film"]);
  const FILM_OVERRIDES: Record<string, string> = {
    blueprint: "Blueprint",
    architecture: "Architecture",
    beat_sheet: "Beat Sheet",
    feature_script: "Script",
  };
  const normalizedFormat = (format || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (normalizedFormat && NON_SERIES.has(normalizedFormat)) {
    const override = FILM_OVERRIDES[docType];
    if (override) return override;
  }
  return LABELS[docType] ?? docType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════
// IFFY-branded PDF renderer using pdf-lib (server-safe, no browser APIs)
// ═══════════════════════════════════════════════════════════════════════════

/** Normalise smart punctuation & mojibake to PDF-safe equivalents */
function normalizeText(s: string): string {
  return s
    // Mojibake patterns (UTF-8 decoded as Windows-1252)
    .replace(/â€™/g, "'").replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"').replace(/â€\u009D/g, '"').replace(/â€/g, '"')
    .replace(/â€"/g, "--").replace(/â€"/g, "-")
    .replace(/â€¦/g, "...")
    // Unicode smart quotes & dashes
    .replace(/[\u2018\u2019\u201A\uFFFD]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2013/g, "-")    // en dash
    .replace(/\u2014/g, "--")   // em dash
    .replace(/\u2026/g, "...")  // ellipsis
    .replace(/\u00A0/g, " ")   // non-breaking space
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "-") // bullet variants
    // Strip any remaining non-Latin1 chars that standard PDF fonts can't render
    .replace(/[^\x00-\xFF]/g, "");
}

/** Lightweight markdown line parser */
interface ParsedBlock {
  type: "h1" | "h2" | "h3" | "hr" | "text";
  content: string;
  bold?: boolean;
}

function parseMarkdownBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split("\n");
  let textBuf = "";

  const flushText = () => {
    if (textBuf.trim()) {
      blocks.push({ type: "text", content: textBuf.trimEnd() });
    }
    textBuf = "";
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushText();
      blocks.push({ type: "hr", content: "" });
    } else if (/^### /.test(trimmed)) {
      flushText();
      blocks.push({ type: "h3", content: trimmed.replace(/^### /, "") });
    } else if (/^## /.test(trimmed)) {
      flushText();
      blocks.push({ type: "h2", content: trimmed.replace(/^## /, "") });
    } else if (/^# /.test(trimmed)) {
      flushText();
      blocks.push({ type: "h1", content: trimmed.replace(/^# /, "") });
    } else {
      textBuf += raw + "\n";
    }
  }
  flushText();
  return blocks;
}

/** Strip markdown bold markers and return segments with bold flags */
interface TextSegment { text: string; bold: boolean }

function parseInlineBold(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      segments.push({ text: part.slice(2, -2), bold: true });
    } else if (part) {
      segments.push({ text: part, bold: false });
    }
  }
  return segments;
}

/** Word-wrap a string to fit within maxWidth using the given font/size */
function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) { lines.push(""); continue; }
    const words = rawLine.split(/\s+/);
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(test, fontSize);
      if (w > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ── Design constants ──
const COLORS = {
  dark:   rgb(20/255, 21/255, 25/255),     // #141519
  amber:  rgb(196/255, 145/255, 58/255),    // #C4913A
  white:  rgb(1, 1, 1),
  body:   rgb(30/255, 30/255, 30/255),
  muted:  rgb(120/255, 115/255, 108/255),
  divider: rgb(80/255, 75/255, 70/255),
};

const PAGE_W = 595.28;  // A4 pt
const PAGE_H = 841.89;
const M = 45.35;        // ~16mm
const CONTENT_W = PAGE_W - M * 2;
const HEADER_H = 40;
const FOOTER_Y = 28;

// Screenplay doc types
const SCREENPLAY_TYPES = new Set([
  "season_script", "episode_script", "season_master_script",
  "script", "feature_script", "production_draft",
]);

// Screenplay layout constants (industry standard)
const SP = {
  LEFT_M: 108,       // 1.5" left margin
  RIGHT_M: 72,       // 1" right margin
  CHAR_X: 252,       // character name position (~3.5" from left)
  DIAL_X: 180,       // dialogue left edge (~2.5")
  DIAL_W: 216,       // dialogue width (~3")
  PAREN_X: 209,      // parenthetical position
  PAREN_W: 180,      // parenthetical width
  TRANS_X: PAGE_W - 72, // transitions right-aligned
  LINE_H: 14,        // 12pt Courier line height
  FONT_SIZE: 12,
  ACTION_W: PAGE_W - 108 - 72, // action width
};

// ── Internal reference sanitization ──
const INTERNAL_PATTERNS = [
  /\bIFFY\b/gi,
  /\bIntelligent Film Flow & Yield\b/gi,
  /\bIntelligent Film Flow and Yield\b/gi,
  /\bdev-engine\b/gi,
  /\bauto-run\b/gi,
  /\bpipeline[_ ]stage\b/gi,
  /\blane[_ ]?(assignment|routing)\b/gi,
  /\bcinematic[_ ]?quality[_ ]?gate\b/gi,
  /\bconvergence[_ ]?index\b/gi,
  /\bgap[_ ]?percentage\b/gi,
  /\breadiness[_ ]?score\b/gi,
];

function sanitizeContent(text: string): string {
  let result = text;
  for (const pattern of INTERNAL_PATTERNS) {
    result = result.replace(pattern, "");
  }
  // Clean up any resulting double spaces or empty lines
  result = result.replace(/  +/g, " ").replace(/\n{3,}/g, "\n\n");
  return result;
}

// ── Screenplay parser ──
interface ScreenplayElement {
  type: "scene_heading" | "character" | "dialogue" | "parenthetical" | "transition" | "action" | "blank";
  text: string;
}

function parseScreenplay(text: string): ScreenplayElement[] {
  const lines = text.split("\n");
  const elements: ScreenplayElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      elements.push({ type: "blank", text: "" });
      i++;
      continue;
    }

    // Scene heading: INT./EXT. or forced with .
    if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/.test(trimmed.toUpperCase()) || /^\.(?!\.)[A-Z]/.test(trimmed)) {
      elements.push({ type: "scene_heading", text: trimmed.replace(/^\./, "").toUpperCase() });
      i++;
      continue;
    }

    // Transition: ends with "TO:" or specific keywords, right-aligned
    if (/^(FADE OUT\.|FADE IN:|CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|JUMP CUT TO:|FADE TO BLACK\.|END\.)$/i.test(trimmed) ||
        (/TO:$/i.test(trimmed) && trimmed === trimmed.toUpperCase())) {
      elements.push({ type: "transition", text: trimmed.toUpperCase() });
      i++;
      continue;
    }

    // Character name: ALL CAPS line (possibly with (V.O.), (O.S.), (CONT'D))
    // Must be followed by dialogue or parenthetical
    const charMatch = trimmed.match(/^([A-Z][A-Z\s.']+(?:\s*\([A-Z.'\s]+\))?)$/);
    if (charMatch && trimmed.length < 60) {
      // Look ahead for dialogue or parenthetical
      const nextLine = i + 1 < lines.length ? lines[i + 1]?.trim() : "";
      if (nextLine && (nextLine.startsWith("(") || (nextLine && nextLine !== nextLine.toUpperCase()))) {
        elements.push({ type: "character", text: trimmed });
        i++;

        // Consume parentheticals and dialogue
        while (i < lines.length) {
          const dl = lines[i]?.trim();
          if (!dl) break;

          if (dl.startsWith("(") && dl.endsWith(")")) {
            elements.push({ type: "parenthetical", text: dl });
            i++;
          } else if (dl === dl.toUpperCase() && dl.length < 60 && /^[A-Z]/.test(dl)) {
            // Next character name - don't consume
            break;
          } else if (/^(INT\.|EXT\.)/.test(dl.toUpperCase())) {
            break;
          } else {
            elements.push({ type: "dialogue", text: dl });
            i++;
          }
        }
        continue;
      }
    }

    // Default: action
    elements.push({ type: "action", text: trimmed });
    i++;
  }

  return elements;
}

/** Build a professional, investor-ready PDF from sections */
async function buildPdf(
  sections: Array<{ label: string; text: string; docType: string }>,
  projectTitle: string,
  projectFormat?: string,
  logoImageBytes?: Uint8Array | null,
  logoMimeType?: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const allPages: any[] = [];

  // ── COVER PAGE ──
  const coverPage = doc.addPage([PAGE_W, PAGE_H]);
  allPages.push(coverPage);

  // Full dark background
  coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COLORS.dark });

  // Amber accent line at top
  coverPage.drawRectangle({ x: 0, y: PAGE_H - 3, width: PAGE_W, height: 3, color: COLORS.amber });

  // Paradox House mark - elegant amber square with "PH"
  const logoSize = 36;
  const logoX = (PAGE_W - logoSize) / 2;
  const logoY = PAGE_H - 160;
  coverPage.drawRectangle({ x: logoX, y: logoY, width: logoSize, height: logoSize, color: COLORS.amber });
  coverPage.drawText("PH", {
    x: logoX + 7, y: logoY + 12, size: 14, font: helveticaBold, color: COLORS.dark,
  });

  // Project title - large, centered
  const titleFontSize = 28;
  const titleText = normalizeText(projectTitle || "Untitled Project");
  const titleLines = wrapText(titleText, helveticaBold, titleFontSize, PAGE_W - 120);
  let titleY = logoY - 50;
  for (const line of titleLines) {
    const tw = helveticaBold.widthOfTextAtSize(line, titleFontSize);
    coverPage.drawText(line, {
      x: (PAGE_W - tw) / 2, y: titleY, size: titleFontSize, font: helveticaBold, color: COLORS.white,
    });
    titleY -= 36;
  }

  // Format / genre subtitle
  if (projectFormat) {
    const formatLabel = normalizeText(projectFormat.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const fmtW = helvetica.widthOfTextAtSize(formatLabel, 11);
    coverPage.drawText(formatLabel, {
      x: (PAGE_W - fmtW) / 2, y: titleY - 10, size: 11, font: helvetica, color: COLORS.muted,
    });
    titleY -= 30;
  }

  // Amber divider
  const divW = 60;
  coverPage.drawRectangle({ x: (PAGE_W - divW) / 2, y: titleY - 10, width: divW, height: 1.5, color: COLORS.amber });

  // Credit block
  const creditY = titleY - 50;
  const creditLine1 = "Written by Sebastian Street";
  const creditLine2 = "Paradox House";
  const c1w = helvetica.widthOfTextAtSize(creditLine1, 12);
  const c2w = helveticaBold.widthOfTextAtSize(creditLine2, 12);
  coverPage.drawText(creditLine1, {
    x: (PAGE_W - c1w) / 2, y: creditY, size: 12, font: helvetica, color: COLORS.white,
  });
  coverPage.drawText(creditLine2, {
    x: (PAGE_W - c2w) / 2, y: creditY - 20, size: 12, font: helveticaBold, color: COLORS.amber,
  });

  // Date at bottom
  const dateW = helvetica.widthOfTextAtSize(dateStr, 8);
  coverPage.drawText(dateStr, {
    x: (PAGE_W - dateW) / 2, y: 50, size: 8, font: helvetica, color: COLORS.muted,
  });

  // Bottom amber accent
  coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 3, color: COLORS.amber });

  // ── Helper: add page with header ──
  function addPage(sectionLabel?: string, isSectionStart = false): { page: any; y: number } {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    allPages.push(page);

    const bandH = isSectionStart ? 56 : HEADER_H;
    // Dark header band
    page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: COLORS.dark });
    // Amber accent stripe
    page.drawRectangle({ x: 0, y: PAGE_H - bandH - 2, width: PAGE_W, height: 2, color: COLORS.amber });

    if (isSectionStart && sectionLabel) {
      // PH mark
      page.drawRectangle({ x: M, y: PAGE_H - 30, width: 18, height: 18, color: COLORS.amber });
      page.drawText("PH", { x: M + 3.5, y: PAGE_H - 25, size: 7, font: helveticaBold, color: COLORS.dark });

      // Section label
      page.drawText(normalizeText(sectionLabel), {
        x: M, y: PAGE_H - 46, size: 18, font: helveticaBold, color: COLORS.white, maxWidth: CONTENT_W,
      });

      // Project title small, top-right
      const shortTitle = normalizeText(projectTitle || "").slice(0, 40);
      const stW = helvetica.widthOfTextAtSize(shortTitle, 7);
      page.drawText(shortTitle, { x: PAGE_W - M - stW, y: PAGE_H - 16, size: 7, font: helvetica, color: COLORS.muted });

      return { page, y: PAGE_H - 56 - 2 - 18 };
    }

    // Continuation header - minimal
    if (sectionLabel) {
      page.drawRectangle({ x: M, y: PAGE_H - 26, width: 14, height: 14, color: COLORS.amber });
      page.drawText("PH", { x: M + 2.5, y: PAGE_H - 22, size: 5, font: helveticaBold, color: COLORS.dark });

      page.drawText(normalizeText(sectionLabel), {
        x: M + 18, y: PAGE_H - 22, size: 8, font: helveticaBold, color: COLORS.white, maxWidth: CONTENT_W - 22,
      });
    }

    return { page, y: PAGE_H - HEADER_H - 2 - 14 };
  }

  // ── Render screenplay section ──
  function renderScreenplay(elements: ScreenplayElement[], sectionLabel: string) {
    let { page, y } = addPage(sectionLabel, true);

    const needsNewPage = (needed: number): boolean => y - needed < FOOTER_Y + 16;
    const newPage = () => { ({ page, y } = addPage(sectionLabel)); };

    for (const el of elements) {
      try {
        switch (el.type) {
          case "blank": {
            y -= SP.LINE_H;
            if (needsNewPage(0)) newPage();
            break;
          }
          case "scene_heading": {
            // Keep scene heading with at least 3 lines of content
            if (needsNewPage(SP.LINE_H * 4)) newPage();
            y -= SP.LINE_H;
            const headLines = wrapText(el.text, courierBold, SP.FONT_SIZE, SP.ACTION_W);
            for (const line of headLines) {
              if (needsNewPage(SP.LINE_H)) newPage();
              page.drawText(line, { x: SP.LEFT_M, y, size: SP.FONT_SIZE, font: courierBold, color: COLORS.body });
              y -= SP.LINE_H;
            }
            y -= SP.LINE_H * 0.5;
            break;
          }
          case "character": {
            // Keep character + at least 2 lines of dialogue together
            if (needsNewPage(SP.LINE_H * 3)) newPage();
            const charW = courierBold.widthOfTextAtSize(el.text, SP.FONT_SIZE);
            // Center character name in dialogue column
            const charX = SP.DIAL_X + (SP.DIAL_W - charW) / 2;
            page.drawText(el.text, {
              x: Math.max(charX, SP.CHAR_X), y, size: SP.FONT_SIZE, font: courierBold, color: COLORS.body,
            });
            y -= SP.LINE_H;
            break;
          }
          case "parenthetical": {
            if (needsNewPage(SP.LINE_H)) newPage();
            const parenLines = wrapText(el.text, courier, SP.FONT_SIZE, SP.PAREN_W);
            for (const line of parenLines) {
              page.drawText(line, { x: SP.PAREN_X, y, size: SP.FONT_SIZE, font: courier, color: COLORS.body });
              y -= SP.LINE_H;
            }
            break;
          }
          case "dialogue": {
            const dialLines = wrapText(el.text, courier, SP.FONT_SIZE, SP.DIAL_W);
            for (const line of dialLines) {
              if (needsNewPage(SP.LINE_H)) newPage();
              page.drawText(line, { x: SP.DIAL_X, y, size: SP.FONT_SIZE, font: courier, color: COLORS.body });
              y -= SP.LINE_H;
            }
            break;
          }
          case "transition": {
            if (needsNewPage(SP.LINE_H * 2)) newPage();
            y -= SP.LINE_H * 0.5;
            const transW = courierBold.widthOfTextAtSize(el.text, SP.FONT_SIZE);
            page.drawText(el.text, {
              x: SP.TRANS_X - transW, y, size: SP.FONT_SIZE, font: courierBold, color: COLORS.body,
            });
            y -= SP.LINE_H;
            break;
          }
          case "action": {
            const actLines = wrapText(el.text, courier, SP.FONT_SIZE, SP.ACTION_W);
            for (const line of actLines) {
              if (needsNewPage(SP.LINE_H)) newPage();
              page.drawText(line, { x: SP.LEFT_M, y, size: SP.FONT_SIZE, font: courier, color: COLORS.body });
              y -= SP.LINE_H;
            }
            break;
          }
        }
      } catch (_err) {
        continue;
      }
    }
  }

  // ── Render prose section (treatments, briefs, bibles, etc.) ──
  function renderProse(text: string, sectionLabel: string) {
    const blocks = parseMarkdownBlocks(text);
    let { page, y } = addPage(sectionLabel, true);

    if (!text.trim() || blocks.length === 0) {
      page.drawText("No content available.", { x: M, y: y - 10, size: 10, font: helvetica, color: COLORS.muted });
      return;
    }

    const needsNewPage = (needed: number): boolean => y - needed < FOOTER_Y + 16;

    for (const block of blocks) {
      try {
        switch (block.type) {
          case "h1": {
            if (needsNewPage(28)) { ({ page, y } = addPage(sectionLabel)); }
            y -= 6;
            page.drawRectangle({ x: M, y: y + 2, width: 40, height: 2, color: COLORS.amber });
            y -= 4;
            const h1Lines = wrapText(block.content, helveticaBold, 16, CONTENT_W);
            for (const line of h1Lines) {
              if (needsNewPage(20)) { ({ page, y } = addPage(sectionLabel)); }
              page.drawText(line, { x: M, y, size: 16, font: helveticaBold, color: COLORS.amber });
              y -= 20;
            }
            y -= 4;
            break;
          }
          case "h2": {
            if (needsNewPage(22)) { ({ page, y } = addPage(sectionLabel)); }
            y -= 4;
            const h2Lines = wrapText(block.content, helveticaBold, 13, CONTENT_W);
            for (const line of h2Lines) {
              if (needsNewPage(17)) { ({ page, y } = addPage(sectionLabel)); }
              page.drawText(line, { x: M, y, size: 13, font: helveticaBold, color: COLORS.body });
              y -= 17;
            }
            y -= 3;
            break;
          }
          case "h3": {
            if (needsNewPage(18)) { ({ page, y } = addPage(sectionLabel)); }
            y -= 3;
            const h3Lines = wrapText(block.content, helveticaBold, 11, CONTENT_W);
            for (const line of h3Lines) {
              if (needsNewPage(15)) { ({ page, y } = addPage(sectionLabel)); }
              page.drawText(line, { x: M, y, size: 11, font: helveticaBold, color: COLORS.body });
              y -= 15;
            }
            y -= 2;
            break;
          }
          case "hr": {
            if (needsNewPage(10)) { ({ page, y } = addPage(sectionLabel)); }
            y -= 4;
            page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: COLORS.amber });
            y -= 6;
            break;
          }
          case "text": {
            const paragraphs = block.content.split(/\n\n+/);
            for (const para of paragraphs) {
              const segments = parseInlineBold(para.replace(/\n/g, " ").trim());
              if (!segments.length) { y -= 6; continue; }
              const plainText = segments.map(s => s.text).join("");
              const wrapped = wrapText(plainText, helvetica, 10, CONTENT_W);
              for (const line of wrapped) {
                if (needsNewPage(14)) { ({ page, y } = addPage(sectionLabel)); }
                const lineSegments = parseInlineBold(line);
                let xPos = M;
                for (const seg of lineSegments) {
                  const f = seg.bold ? helveticaBold : helvetica;
                  page.drawText(seg.text, { x: xPos, y, size: 10, font: f, color: COLORS.body });
                  xPos += f.widthOfTextAtSize(seg.text, 10);
                }
                y -= 14;
              }
              y -= 4;
            }
            break;
          }
        }
      } catch (_blockErr) {
        continue;
      }
    }
  }

  // ── Render each section ──
  for (const sec of sections) {
    const cleanText = sanitizeContent(normalizeText(sec.text || ""));
    const isScreenplay = SCREENPLAY_TYPES.has(sec.docType);

    if (isScreenplay) {
      const elements = parseScreenplay(cleanText);
      renderScreenplay(elements, sec.label);
    } else {
      renderProse(cleanText, sec.label);
    }
  }

  // ── Draw footers on all pages ──
  const totalPages = allPages.length;
  for (let i = 0; i < totalPages; i++) {
    const page = allPages[i];
    try {
      page.drawLine({
        start: { x: M, y: FOOTER_Y + 6 },
        end: { x: PAGE_W - M, y: FOOTER_Y + 6 },
        thickness: 0.4,
        color: COLORS.amber,
      });
      // Left: Paradox House credit
      const footerLeft = "Paradox House -- Confidential";
      page.drawText(footerLeft, { x: M, y: FOOTER_Y - 2, size: 6, font: helvetica, color: COLORS.muted });
      // Right: page number
      const pageNum = `Page ${i + 1} of ${totalPages}`;
      const pnWidth = helvetica.widthOfTextAtSize(pageNum, 6);
      page.drawText(pageNum, { x: PAGE_W - M - pnWidth, y: FOOTER_Y - 2, size: 6, font: helvetica, color: COLORS.muted });
    } catch (_footerErr) {
      // Don't crash on footer rendering
    }
  }

  return await doc.save();
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      projectId,
      scope = "approved_preferred",
      include_master_script = true,
      include_types,
      expiresInSeconds = 604800,
      output_format = "zip", // "zip" | "pdf"
    } = body;

    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch project
    const { data: project, error: projErr } = await sb
      .from("projects")
      .select("id, title, format, pipeline_stage")
      .eq("id", projectId)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build ordered doc list from canonical ladder
    let ladder = getLadder(project.format);
    if (!include_master_script) {
      ladder = ladder.filter(dt => dt !== "season_master_script");
    }
    if (include_types && Array.isArray(include_types)) {
      ladder = ladder.filter(dt => include_types.includes(dt));
    }

    // Fetch all project_documents
    const { data: docs } = await sb
      .from("project_documents")
      .select("id, doc_type, title, latest_version_id, file_name")
      .eq("project_id", projectId) as { data: any[] | null };

    const allDocs: any[] = docs || [];
    // Group docs by doc_type (multiple docs can share the same doc_type, e.g. multiple scripts)
    const docMap = new Map<string, any[]>();
    for (const d of allDocs) {
      if (!docMap.has(d.doc_type)) docMap.set(d.doc_type, []);
      docMap.get(d.doc_type)!.push(d);
    }

    // --- Build approved version map (final status) ---
    type ApprovedMap = Map<string, { id: string; plaintext: string; version_number: number }>;
    let approvedMap: ApprovedMap = new Map();
    if (scope !== "latest_only") {
      const docIds = allDocs.map((d: any) => d.id as string);
      if (docIds.length > 0) {
        const { data: finalVersions } = await sb
          .from("project_document_versions")
          .select("id, document_id, status, plaintext, version_number")
          .in("document_id", docIds)
          .eq("status", "final")
          .order("version_number", { ascending: false }) as { data: any[] | null };
        for (const v of (finalVersions || [])) {
          if (!approvedMap.has(v.document_id)) {
            approvedMap.set(v.document_id, v);
          }
        }
      }
    }

    // --- Build latest version map (two-pass: pointer first, then highest version_number) ---
    const latestByDocId = new Map<string, any>();

    const latestVersionIds = allDocs
      .filter((d: any) => d.latest_version_id)
      .map((d: any) => d.latest_version_id as string);

    if (latestVersionIds.length > 0) {
      const { data: latestVersions } = await sb
        .from("project_document_versions")
        .select("id, document_id, status, plaintext, version_number, created_at")
        .in("id", latestVersionIds) as { data: any[] | null };
      for (const v of latestVersions || []) {
        latestByDocId.set(v.document_id, v);
      }
    }

    // Fallback: docs still missing a latest — fetch by highest version_number
    const docsStillMissing = allDocs.filter((d: any) => !latestByDocId.has(d.id));
    if (docsStillMissing.length > 0) {
      const missingIds = docsStillMissing.map((d: any) => d.id as string);
      const { data: fallbackVersions } = await sb
        .from("project_document_versions")
        .select("id, document_id, status, plaintext, version_number, created_at")
        .in("document_id", missingIds)
        .order("version_number", { ascending: false }) as { data: any[] | null };
      for (const v of fallbackVersions || []) {
        if (!latestByDocId.has(v.document_id)) {
          latestByDocId.set(v.document_id, v);
        }
      }
    }

    // --- Build deliverable list in ladder order ---
    const metaDocs: any[] = [];
    const sections: Array<{ label: string; text: string; docType: string }> = [];

    let globalOrder = 1;
    for (let i = 0; i < ladder.length; i++) {
      const docType = ladder[i];
      const docsForType = docMap.get(docType);
      if (!docsForType || docsForType.length === 0) continue;

      for (const doc of docsForType) {
        let versionId: string | null = null;
        let plaintext: string | null = null;
        let approved = false;

        if (scope === "approved_preferred" || scope === "approved_only") {
          const approvedVer = approvedMap.get(doc.id);
          if (approvedVer) {
            versionId = approvedVer.id;
            plaintext = approvedVer.plaintext;
            approved = true;
          } else if (scope === "approved_only") {
            continue;
          } else {
            const latestVer = latestByDocId.get(doc.id);
            if (latestVer) {
              versionId = latestVer.id;
              plaintext = latestVer.plaintext;
              approved = false;
            }
          }
        } else {
          const latestVer = latestByDocId.get(doc.id);
          if (latestVer) {
            versionId = latestVer.id;
            plaintext = latestVer.plaintext;
            approved = latestVer.status === "final";
          }
        }

        if (!plaintext) continue;

        const orderPrefix = String(globalOrder).padStart(2, "0");
        const label = toLabel(docType, project.format);
        const statusSuffix = approved ? "APPROVED" : "DRAFT";
        const fileName = `${orderPrefix}_${docType}_${statusSuffix}.md`;

        sections.push({ label, text: plaintext, docType });
        metaDocs.push({
          order_index: globalOrder,
          doc_type: docType,
          label,
          doc_id: doc.id,
          version_id: versionId,
          approved,
          file_name: fileName,
          plaintext,
        });
        globalOrder++;
      }
    }

    if (metaDocs.length === 0) {
      return new Response(JSON.stringify({ error: "No documents available for export with the selected scope" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Generate output (ZIP or PDF) ---
    let fileBuffer: Uint8Array;
    let contentType: string;
    let fileExtension: string;

    if (output_format === "pdf") {
      fileBuffer = await buildPdf(sections, project.title || "Untitled Project", project.format);
      contentType = "application/pdf";
      fileExtension = "pdf";
    } else {
      const zip = new JSZip();
      for (const doc of metaDocs) {
        zip.file(doc.file_name, doc.plaintext);
      }
      // metadata
      const metadata = {
        project_id: projectId,
        title: project.title,
        format: project.format,
        exported_at: new Date().toISOString(),
        scope,
        docs: metaDocs.map(({ plaintext: _pt, ...rest }) => rest),
      };
      zip.file("metadata.json", JSON.stringify(metadata, null, 2));
      fileBuffer = await zip.generateAsync({ type: "uint8array" });
      contentType = "application/zip";
      fileExtension = "zip";
    }

    // --- Build a meaningful filename ---
    // Find the latest created_at across all included versions
    let lastEditedDate = new Date(0);
    for (const doc of metaDocs) {
      // Check in latestByDocId and approvedMap for created_at
      const ver = latestByDocId.get(doc.doc_id) || approvedMap.get(doc.doc_id);
      if (ver?.created_at) {
        const d = new Date(ver.created_at);
        if (d > lastEditedDate) lastEditedDate = d;
      }
    }
    const dateStr = lastEditedDate > new Date(0)
      ? lastEditedDate.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const safeTitle = (project.title || "package")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const suggestedFileName = `${safeTitle}_${dateStr}.${fileExtension}`;

    // Upload to exports bucket
    const timestamp = Date.now();
    const storagePath = `${user.id}/${projectId}/${timestamp}_package.${fileExtension}`;

    const { error: uploadErr } = await sb.storage
      .from("exports")
      .upload(storagePath, fileBuffer, { contentType, upsert: true });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return new Response(JSON.stringify({ error: `Storage upload failed: ${uploadErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signedUrlData, error: signedErr } = await sb.storage
      .from("exports")
      .createSignedUrl(storagePath, expiresInSeconds);

    if (signedErr || !signedUrlData) {
      return new Response(JSON.stringify({ error: "Failed to create signed URL" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    await sb.from("project_share_links").insert({
      project_id: projectId,
      scope,
      expires_at: expiresAt,
      signed_url: signedUrlData.signedUrl,
      storage_path: storagePath,
      created_by: user.id,
    } as any);

    return new Response(
      JSON.stringify({
        signed_url: signedUrlData.signedUrl,
        storage_path: storagePath,
        expires_at: expiresAt,
        doc_count: metaDocs.length,
        output_format: fileExtension,
        file_name: suggestedFileName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("export-package error:", err);
    if (err.message === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "RATE_LIMIT" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
