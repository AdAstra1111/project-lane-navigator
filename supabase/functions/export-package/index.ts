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
// Studio-grade PDF renderer — Paradox House branded, pdf-lib (Deno-safe)
// ═══════════════════════════════════════════════════════════════════════════

/** Normalise smart punctuation & mojibake to PDF-safe equivalents */
function normalizeText(s: string): string {
  return s
    .replace(/â€™/g, "'").replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"').replace(/â€\u009D/g, '"').replace(/â€/g, '"')
    .replace(/â€"/g, "--").replace(/â€"/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/[\u2018\u2019\u201A\uFFFD]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

interface ParsedBlock { type: "h1" | "h2" | "h3" | "hr" | "text"; content: string; bold?: boolean }

function parseMarkdownBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split("\n");
  let textBuf = "";
  const flushText = () => { if (textBuf.trim()) blocks.push({ type: "text", content: textBuf.trimEnd() }); textBuf = ""; };
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) { flushText(); blocks.push({ type: "hr", content: "" }); }
    else if (/^### /.test(trimmed)) { flushText(); blocks.push({ type: "h3", content: trimmed.replace(/^### /, "") }); }
    else if (/^## /.test(trimmed)) { flushText(); blocks.push({ type: "h2", content: trimmed.replace(/^## /, "") }); }
    else if (/^# /.test(trimmed)) { flushText(); blocks.push({ type: "h1", content: trimmed.replace(/^# /, "") }); }
    else { textBuf += raw + "\n"; }
  }
  flushText();
  return blocks;
}

interface TextSegment { text: string; bold: boolean }
function parseInlineBold(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) segments.push({ text: part.slice(2, -2), bold: true });
    else if (part) segments.push({ text: part, bold: false });
  }
  return segments;
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) { lines.push(""); continue; }
    const words = rawLine.split(/\s+/);
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(test, fontSize);
      if (w > maxWidth && current) { lines.push(current); current = word; }
      else current = test;
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ── Design tokens ──
const COLORS = {
  dark:    rgb(20/255, 21/255, 25/255),
  amber:   rgb(196/255, 145/255, 58/255),
  white:   rgb(1, 1, 1),
  body:    rgb(30/255, 30/255, 30/255),
  muted:   rgb(150/255, 145/255, 138/255),
  divider: rgb(200/255, 195/255, 190/255),
  heading: rgb(40/255, 38/255, 36/255),
};

// US Letter dimensions (standard screenplay page)
const PAGE_W = 612;   // 8.5"
const PAGE_H = 792;   // 11"
const M = 54;          // ~0.75" general margin
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_Y = 36;
const TOP_Y = PAGE_H - 54;

// Screenplay doc types
const SCREENPLAY_TYPES = new Set([
  "season_script", "episode_script", "season_master_script",
  "script", "feature_script", "production_draft",
]);

// Screenplay layout — exact industry standard (Final Draft / StudioBinder match)
const SP = {
  LEFT_M: 108,          // 1.5" left margin
  RIGHT_M: 72,          // 1" right margin
  CHAR_X: 252,          // character name ~3.5" from left
  DIAL_X: 180,          // dialogue left ~2.5"
  DIAL_W: 216,          // dialogue width ~3"
  PAREN_X: 216,         // parenthetical slightly right of dialogue
  PAREN_W: 168,         // parenthetical narrower
  TRANS_X: PAGE_W - 72, // transitions right-aligned at 1" margin
  LINE_H: 14,           // 12pt line height
  FONT_SIZE: 12,
  ACTION_W: PAGE_W - 108 - 72,
};

// ── Internal reference sanitization ──
const INTERNAL_PATTERNS = [
  /\bIFFY\b/gi, /\bIntelligent Film Flow & Yield\b/gi, /\bIntelligent Film Flow and Yield\b/gi,
  /\bdev-engine\b/gi, /\bauto-run\b/gi, /\bpipeline[_ ]stage\b/gi,
  /\blane[_ ]?(assignment|routing)\b/gi, /\bcinematic[_ ]?quality[_ ]?gate\b/gi,
  /\bconvergence[_ ]?index\b/gi, /\bgap[_ ]?percentage\b/gi, /\breadiness[_ ]?score\b/gi,
];

// Artifact patterns that leak from upstream parsing
const ARTIFACT_PATTERNS = [
  /<PARSED TEXT FOR PAGE:[^>]*>/gi,
  /\d+\s*Confidential[^\n]*/gi,
  /^Confidential\s*$/gm,
  /Page \d+ of \d+/gi,
  /Generated by [A-Z]+/gi,
  /\[SYSTEM[^\]]*\]/gi,
  /\[DEBUG[^\]]*\]/gi,
  /\[INTERNAL[^\]]*\]/gi,
];

function sanitizeContent(text: string): string {
  let result = text;
  for (const pattern of INTERNAL_PATTERNS) result = result.replace(pattern, "");
  for (const pattern of ARTIFACT_PATTERNS) result = result.replace(pattern, "");
  // Clean up resulting whitespace
  return result.replace(/  +/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
    if (!trimmed) { elements.push({ type: "blank", text: "" }); i++; continue; }
    if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/.test(trimmed.toUpperCase()) || /^\.(?!\.)[A-Z]/.test(trimmed)) {
      elements.push({ type: "scene_heading", text: trimmed.replace(/^\./, "").toUpperCase() }); i++; continue;
    }
    if (/^(FADE OUT\.|FADE IN:|CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|JUMP CUT TO:|FADE TO BLACK\.|END\.)$/i.test(trimmed) ||
        (/TO:$/i.test(trimmed) && trimmed === trimmed.toUpperCase())) {
      elements.push({ type: "transition", text: trimmed.toUpperCase() }); i++; continue;
    }
    const charMatch = trimmed.match(/^([A-Z][A-Z\s.']+(?:\s*\([A-Z.'\s]+\))?)$/);
    if (charMatch && trimmed.length < 60) {
      const nextLine = i + 1 < lines.length ? lines[i + 1]?.trim() : "";
      if (nextLine && (nextLine.startsWith("(") || (nextLine && nextLine !== nextLine.toUpperCase()))) {
        elements.push({ type: "character", text: trimmed }); i++;
        while (i < lines.length) {
          const dl = lines[i]?.trim();
          if (!dl) break;
          if (dl.startsWith("(") && dl.endsWith(")")) { elements.push({ type: "parenthetical", text: dl }); i++; }
          else if (dl === dl.toUpperCase() && dl.length < 60 && /^[A-Z]/.test(dl)) break;
          else if (/^(INT\.|EXT\.)/.test(dl.toUpperCase())) break;
          else { elements.push({ type: "dialogue", text: dl }); i++; }
        }
        continue;
      }
    }
    elements.push({ type: "action", text: trimmed }); i++;
  }
  return elements;
}

/** Build a professional, studio-grade PDF package */
async function buildPdf(
  sections: Array<{ label: string; text: string; docType: string }>,
  projectTitle: string,
  projectFormat?: string,
  logoImageBytes?: Uint8Array | null,
  logoMimeType?: string,
  posterImageBytes?: Uint8Array | null,
  posterMimeType?: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const allPages: any[] = [];

  // ── Embed logo image if provided ──
  let logoImage: any = null;
  let logoDims = { width: 36, height: 36 };
  if (logoImageBytes && logoImageBytes.length > 0) {
    try {
      if (logoMimeType?.includes("png")) logoImage = await doc.embedPng(logoImageBytes);
      else logoImage = await doc.embedJpg(logoImageBytes);
      const scale = logoImage.scale(1);
      logoDims = { width: scale.width, height: scale.height };
    } catch (e) {
      console.warn("Failed to embed logo image, using fallback:", e);
      logoImage = null;
    }
  }

  // Draw logo centered at (cx, cy) with max height
  function drawLogoCentered(page: any, cx: number, cy: number, maxH: number) {
    if (logoImage) {
      const aspect = logoDims.width / logoDims.height;
      const h = Math.min(maxH, logoDims.height);
      const w = h * aspect;
      page.drawImage(logoImage, { x: cx - w / 2, y: cy, width: w, height: h });
    } else {
      // Fallback: elegant text mark
      const mark = "PARADOX HOUSE";
      const mw = helveticaBold.widthOfTextAtSize(mark, 8);
      page.drawText(mark, { x: cx - mw / 2, y: cy + 4, size: 8, font: helveticaBold, color: COLORS.amber });
    }
  }

  // Draw small logo left-aligned (for running headers)
  function drawLogoSmall(page: any, x: number, cy: number, maxH: number) {
    if (logoImage) {
      const aspect = logoDims.width / logoDims.height;
      const h = Math.min(maxH, logoDims.height);
      const w = h * aspect;
      page.drawImage(logoImage, { x, y: cy, width: w, height: h });
    }
    // No fallback in headers — keep them clean if no logo
  }

  // ═══════════════════════════════════════════════
  // COVER PAGE — cinematic, dark background
  // ═══════════════════════════════════════════════
  const coverPage = doc.addPage([PAGE_W, PAGE_H]);
  allPages.push(coverPage);

  coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COLORS.dark });

  // Thin amber accent at top
  coverPage.drawRectangle({ x: 0, y: PAGE_H - 2, width: PAGE_W, height: 2, color: COLORS.amber });

  // Logo — centered, generous vertical position
  drawLogoCentered(coverPage, PAGE_W / 2, PAGE_H - 180, 56);

  // Project title — large, centered
  const titleFontSize = 26;
  const titleText = normalizeText(projectTitle || "Untitled Project");
  const titleLines = wrapText(titleText, helveticaBold, titleFontSize, PAGE_W - 140);
  let titleY = PAGE_H - 260;
  for (const line of titleLines) {
    const tw = helveticaBold.widthOfTextAtSize(line, titleFontSize);
    coverPage.drawText(line, { x: (PAGE_W - tw) / 2, y: titleY, size: titleFontSize, font: helveticaBold, color: COLORS.white });
    titleY -= 34;
  }

  // Format subtitle
  if (projectFormat) {
    const formatLabel = normalizeText(projectFormat.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const fmtW = helvetica.widthOfTextAtSize(formatLabel, 10);
    coverPage.drawText(formatLabel, { x: (PAGE_W - fmtW) / 2, y: titleY - 8, size: 10, font: helvetica, color: COLORS.muted });
    titleY -= 28;
  }

  // Subtle divider
  const divW = 50;
  coverPage.drawRectangle({ x: (PAGE_W - divW) / 2, y: titleY - 8, width: divW, height: 1, color: COLORS.amber });

  // Credit block
  const creditY = titleY - 48;
  const creditLine1 = "Written by Sebastian Street";
  const creditLine2 = "Paradox House";
  const c1w = helvetica.widthOfTextAtSize(creditLine1, 11);
  const c2w = helveticaBold.widthOfTextAtSize(creditLine2, 11);
  coverPage.drawText(creditLine1, { x: (PAGE_W - c1w) / 2, y: creditY, size: 11, font: helvetica, color: COLORS.white });
  coverPage.drawText(creditLine2, { x: (PAGE_W - c2w) / 2, y: creditY - 18, size: 11, font: helveticaBold, color: COLORS.amber });

  // Date at bottom
  const dateW = helvetica.widthOfTextAtSize(dateStr, 7);
  coverPage.drawText(dateStr, { x: (PAGE_W - dateW) / 2, y: 44, size: 7, font: helvetica, color: COLORS.muted });

  // Bottom accent
  coverPage.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 2, color: COLORS.amber });

  // ═══════════════════════════════════════════════
  // EDITORIAL PAGE HELPERS — no UI bands, clean editorial style
  // ═══════════════════════════════════════════════

  /** Add a content page with minimal editorial running header */
  function addContentPage(sectionLabel?: string): { page: any; y: number } {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    allPages.push(page);

    // Running header: subtle, editorial — just text, no bands
    if (sectionLabel) {
      const headerY = PAGE_H - 36;
      // Small logo left, then section label offset right of it
      const logoOffset = logoImage ? 16 : 0;
      drawLogoSmall(page, M, headerY - 2, 10);
      page.drawText(normalizeText(sectionLabel).toUpperCase(), {
        x: M + logoOffset, y: headerY, size: 6.5, font: helvetica, color: COLORS.muted,
      });
      // Thin separator line
      page.drawLine({
        start: { x: M, y: headerY - 8 },
        end: { x: PAGE_W - M, y: headerY - 8 },
        thickness: 0.25,
        color: COLORS.divider,
      });
    }

    return { page, y: PAGE_H - 62 };
  }

  /** Add a section start page — editorial title treatment, no UI bands */
  function addSectionStartPage(sectionLabel: string): { page: any; y: number } {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    allPages.push(page);

    // Section title — editorial, generous top spacing
    const sectionY = PAGE_H - 160;

    // Slim amber accent line
    page.drawRectangle({ x: M, y: sectionY + 18, width: 32, height: 1.5, color: COLORS.amber });

    // Section title — clean, no project name repetition
    const secTitle = normalizeText(sectionLabel);
    const secLines = wrapText(secTitle, timesBold, 24, CONTENT_W);
    let sy = sectionY;
    for (const line of secLines) {
      page.drawText(line, { x: M, y: sy, size: 24, font: timesBold, color: COLORS.heading });
      sy -= 30;
    }

    return { page, y: sy - 20 };
  }

  // ═══════════════════════════════════════════════
  // SCREENPLAY TITLE PAGE — industry standard
  // ═══════════════════════════════════════════════
  function addScreenplayTitlePage(sectionLabel: string) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    allPages.push(page);

    // Title — centered, upper third
    const stTitle = normalizeText(projectTitle || "Untitled");
    const stLines = wrapText(stTitle, courierBold, 24, PAGE_W - 160);
    let sty = PAGE_H - 240;
    for (const line of stLines) {
      const tw = courierBold.widthOfTextAtSize(line, 24);
      page.drawText(line, { x: (PAGE_W - tw) / 2, y: sty, size: 24, font: courierBold, color: COLORS.body });
      sty -= 30;
    }

    // Section label (e.g., "Season Script")
    const secLabel = normalizeText(sectionLabel);
    const slw = courier.widthOfTextAtSize(secLabel, 12);
    page.drawText(secLabel, { x: (PAGE_W - slw) / 2, y: sty - 10, size: 12, font: courier, color: COLORS.body });

    // "Written by" block — centered, below title
    const wby = sty - 60;
    const writtenBy = "Written by";
    const wbw = courier.widthOfTextAtSize(writtenBy, 12);
    page.drawText(writtenBy, { x: (PAGE_W - wbw) / 2, y: wby, size: 12, font: courier, color: COLORS.body });

    const authorName = "Sebastian Street";
    const anw = courier.widthOfTextAtSize(authorName, 12);
    page.drawText(authorName, { x: (PAGE_W - anw) / 2, y: wby - 20, size: 12, font: courier, color: COLORS.body });

    // Company — lower
    const companyY = wby - 60;
    const company = "Paradox House";
    const cw = courier.widthOfTextAtSize(company, 12);
    page.drawText(company, { x: (PAGE_W - cw) / 2, y: companyY, size: 12, font: courier, color: COLORS.body });

    // Date bottom-right (industry convention)
    page.drawText(dateStr, { x: PAGE_W - M - courier.widthOfTextAtSize(dateStr, 10), y: FOOTER_Y + 20, size: 10, font: courier, color: COLORS.body });
  }

  // ═══════════════════════════════════════════════
  // SCREENPLAY RENDERER
  // ═══════════════════════════════════════════════
  function renderScreenplay(elements: ScreenplayElement[], sectionLabel: string) {
    // Screenplay title page first
    addScreenplayTitlePage(sectionLabel);

    // First content page — plain white, no UI header, just running header
    let { page, y } = addContentPage(sectionLabel);

    const needsNewPage = (needed: number): boolean => y - needed < FOOTER_Y + 16;
    const newPage = () => { ({ page, y } = addContentPage(sectionLabel)); };

    for (const el of elements) {
      try {
        switch (el.type) {
          case "blank": {
            y -= SP.LINE_H;
            if (needsNewPage(0)) newPage();
            break;
          }
          case "scene_heading": {
            // Never orphan a scene heading — require heading + at least 2 lines below
            if (needsNewPage(SP.LINE_H * 5)) newPage();
            y -= SP.LINE_H * 1.5; // double-space before scene heading
            const headLines = wrapText(el.text, courierBold, SP.FONT_SIZE, SP.ACTION_W);
            for (const line of headLines) {
              if (needsNewPage(SP.LINE_H)) newPage();
              page.drawText(line, { x: SP.LEFT_M, y, size: SP.FONT_SIZE, font: courierBold, color: COLORS.body });
              y -= SP.LINE_H;
            }
            y -= SP.LINE_H * 0.25;
            break;
          }
          case "character": {
            if (needsNewPage(SP.LINE_H * 3)) newPage();
            y -= SP.LINE_H * 0.5;
            // Center character name over dialogue column
            const charW = courierBold.widthOfTextAtSize(el.text, SP.FONT_SIZE);
            const charX = SP.DIAL_X + (SP.DIAL_W - charW) / 2;
            page.drawText(el.text, {
              x: charX, y, size: SP.FONT_SIZE, font: courierBold, color: COLORS.body,
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
      } catch (_err) { continue; }
    }
  }

  // ═══════════════════════════════════════════════
  // PROSE RENDERER — editorial quality (Times Roman)
  // ═══════════════════════════════════════════════
  // Prose constants — editorial quality spacing
  const PROSE_BODY_SIZE = 10.5;
  const PROSE_LINE_H = 17;         // generous leading for readability
  const PROSE_PARA_GAP = 10;       // clear paragraph separation
  const PROSE_MAX_W = Math.min(CONTENT_W, 430); // limit line width for comfort
  const PROSE_H1_SIZE = 18;
  const PROSE_H2_SIZE = 13;
  const PROSE_H3_SIZE = 11;

  function renderProse(text: string, sectionLabel: string) {
    const blocks = parseMarkdownBlocks(text);
    let { page, y } = addSectionStartPage(sectionLabel);

    if (!text.trim() || blocks.length === 0) {
      page.drawText("No content available.", { x: M, y: y - 10, size: PROSE_BODY_SIZE, font: timesItalic, color: COLORS.muted });
      return;
    }

    const needsNewPage = (needed: number): boolean => y - needed < FOOTER_Y + 16;
    const newPage = () => { ({ page, y } = addContentPage(sectionLabel)); };

    for (const block of blocks) {
      try {
        switch (block.type) {
          case "h1": {
            if (needsNewPage(40)) newPage();
            y -= 18;
            // Slim amber accent
            page.drawRectangle({ x: M, y: y + 5, width: 28, height: 1.2, color: COLORS.amber });
            y -= 2;
            const h1Lines = wrapText(block.content, timesBold, PROSE_H1_SIZE, PROSE_MAX_W);
            for (const line of h1Lines) {
              if (needsNewPage(26)) newPage();
              page.drawText(line, { x: M, y, size: PROSE_H1_SIZE, font: timesBold, color: COLORS.heading });
              y -= 26;
            }
            y -= 10;
            break;
          }
          case "h2": {
            if (needsNewPage(30)) newPage();
            y -= 14;
            const h2Lines = wrapText(block.content, timesBold, PROSE_H2_SIZE, PROSE_MAX_W);
            for (const line of h2Lines) {
              if (needsNewPage(20)) newPage();
              page.drawText(line, { x: M, y, size: PROSE_H2_SIZE, font: timesBold, color: COLORS.heading });
              y -= 20;
            }
            y -= 6;
            break;
          }
          case "h3": {
            if (needsNewPage(24)) newPage();
            y -= 8;
            const h3Lines = wrapText(block.content, timesItalic, PROSE_H3_SIZE, PROSE_MAX_W);
            for (const line of h3Lines) {
              if (needsNewPage(18)) newPage();
              page.drawText(line, { x: M, y, size: PROSE_H3_SIZE, font: timesItalic, color: COLORS.heading });
              y -= 18;
            }
            y -= 4;
            break;
          }
          case "hr": {
            if (needsNewPage(16)) newPage();
            y -= 8;
            page.drawLine({
              start: { x: M, y },
              end: { x: M + 80, y },
              thickness: 0.4,
              color: COLORS.divider,
            });
            y -= 10;
            break;
          }
          case "text": {
            const paragraphs = block.content.split(/\n\n+/);
            for (const para of paragraphs) {
              const cleanPara = para.replace(/\n/g, " ").trim();
              if (!cleanPara) { y -= PROSE_PARA_GAP; continue; }
              const wrapped = wrapText(cleanPara, timesRoman, PROSE_BODY_SIZE, PROSE_MAX_W);
              for (const line of wrapped) {
                if (needsNewPage(PROSE_LINE_H)) newPage();
                // Render with inline bold support
                const lineSegments = parseInlineBold(line);
                let xPos = M;
                for (const seg of lineSegments) {
                  const f = seg.bold ? timesBold : timesRoman;
                  page.drawText(seg.text, { x: xPos, y, size: PROSE_BODY_SIZE, font: f, color: COLORS.body });
                  xPos += f.widthOfTextAtSize(seg.text, PROSE_BODY_SIZE);
                }
                y -= PROSE_LINE_H;
              }
              y -= PROSE_PARA_GAP;
            }
            break;
          }
        }
      } catch (_blockErr) { continue; }
    }
  }

  // ═══════════════════════════════════════════════
  // POSTER PAGE — full-page image after cover
  // ═══════════════════════════════════════════════
  if (posterImageBytes && posterImageBytes.length > 0) {
    try {
      let posterImg: any;
      if (posterMimeType?.includes("png")) posterImg = await doc.embedPng(posterImageBytes);
      else posterImg = await doc.embedJpg(posterImageBytes);
      const posterDims = posterImg.scale(1);

      const posterPage = doc.addPage([PAGE_W, PAGE_H]);
      allPages.push(posterPage);

      // Scale to fit page while preserving aspect ratio, with small margin
      const posterMargin = 36;
      const availW = PAGE_W - posterMargin * 2;
      const availH = PAGE_H - posterMargin * 2;
      const aspect = posterDims.width / posterDims.height;
      let drawW: number, drawH: number;
      if (aspect > availW / availH) {
        drawW = availW;
        drawH = availW / aspect;
      } else {
        drawH = availH;
        drawW = availH * aspect;
      }
      const drawX = (PAGE_W - drawW) / 2;
      const drawY = (PAGE_H - drawH) / 2;
      posterPage.drawImage(posterImg, { x: drawX, y: drawY, width: drawW, height: drawH });
    } catch (e) {
      console.warn("Failed to embed poster image, skipping:", e);
    }
  }

  // ═══════════════════════════════════════════════
  // RENDER ALL SECTIONS
  // ═══════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════
  // FOOTERS — subtle, professional
  // ═══════════════════════════════════════════════
  const totalPages = allPages.length;
  for (let i = 0; i < totalPages; i++) {
    const page = allPages[i];
    try {
      // Skip cover page footer
      if (i === 0) continue;

      // Page number — centered, very small, light
      const pageNum = `${i}`;
      const pnWidth = helvetica.widthOfTextAtSize(pageNum, 7);
      page.drawText(pageNum, { x: (PAGE_W - pnWidth) / 2, y: FOOTER_Y, size: 7, font: helvetica, color: COLORS.divider });
    } catch (_footerErr) { /* don't crash on footer */ }
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

    // ── Fetch brand logo asset for PDF rendering ──
    let logoBytes: Uint8Array | null = null;
    let logoMime = "image/png";
    try {
      const { data: brandAsset } = await sb
        .from("brand_assets")
        .select("storage_path, mime_type")
        .eq("user_id", user.id)
        .eq("asset_type", "logo")
        .eq("label", "primary")
        .maybeSingle();
      if (brandAsset?.storage_path) {
        const { data: fileData } = await sb.storage
          .from("brand-assets")
          .download(brandAsset.storage_path);
        if (fileData) {
          logoBytes = new Uint8Array(await fileData.arrayBuffer());
          logoMime = brandAsset.mime_type || "image/png";
        }
      }
    } catch (e) {
      console.warn("Brand logo fetch failed, using fallback:", e);
    }

    // --- Generate output (ZIP or PDF) ---
    let fileBuffer: Uint8Array;
    let contentType: string;
    let fileExtension: string;

    if (output_format === "pdf") {
      fileBuffer = await buildPdf(sections, project.title || "Untitled Project", project.format, logoBytes, logoMime);
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
