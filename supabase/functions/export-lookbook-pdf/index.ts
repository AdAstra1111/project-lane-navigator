/**
 * export-lookbook-pdf — Renders Look Book slides to a studio-grade PDF.
 * Consumes the same LookBookData schema as the in-browser viewer.
 * Supports both landscape (1280×720) and portrait (720×1280) page geometries.
 * POST { projectId, lookBookData }
 * Returns { signed_url }
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Types (mirrors src/lib/lookbook/types.ts) ──
interface SlideContent {
  type: string;
  title?: string;
  subtitle?: string;
  body?: string;
  bodySecondary?: string;
  bullets?: string[];
  quote?: string;
  characters?: Array<{ name: string; role: string; description: string }>;
  comparables?: Array<{ title: string; reason: string }>;
  credit?: string;
  companyName?: string;
}

interface LookBookColorSystem {
  bg: string;
  bgSecondary: string;
  text: string;
  textMuted: string;
  accent: string;
}

interface LookBookData {
  projectId: string;
  projectTitle: string;
  identity: {
    colors: LookBookColorSystem;
    typography: { titleFont: string; bodyFont: string; titleUppercase: boolean };
  };
  slides: SlideContent[];
  deckFormat?: 'landscape' | 'portrait';
  writerCredit: string;
  companyName: string;
}

// ── Helpers ──
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function pdfColor(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r, g, b);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(sbUrl, sbKey);

    // Verify auth
    const anonClient = createClient(sbUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId, lookBookData } = await req.json() as {
      projectId: string;
      lookBookData: LookBookData;
    };

    if (!projectId || !lookBookData?.slides?.length) {
      return new Response(JSON.stringify({ error: "Missing data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve page geometry from deckFormat ──
    const isPortrait = lookBookData.deckFormat === 'portrait';
    const PAGE_W = isPortrait ? 720 : 1280;
    const PAGE_H = isPortrait ? 1280 : 720;
    const MARGIN = isPortrait ? 60 : 80;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    console.log(`[export-lookbook-pdf] deckFormat=${lookBookData.deckFormat || 'landscape'} pageSize=${PAGE_W}x${PAGE_H}`);

    // ── Build PDF ──
    const pdfDoc = await PDFDocument.create();
    const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const colors = lookBookData.identity.colors;
    const bgColor = pdfColor(colors.bg);
    const textColor = pdfColor(colors.text);
    const mutedColor = pdfColor(colors.textMuted);
    const accentColor = pdfColor(colors.accent);

    for (let si = 0; si < lookBookData.slides.length; si++) {
      const slide = lookBookData.slides[si];
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      // Background
      page.drawRectangle({
        x: 0, y: 0, width: PAGE_W, height: PAGE_H,
        color: bgColor,
      });

      // Accent line
      page.drawRectangle({
        x: MARGIN, y: PAGE_H - MARGIN - 4,
        width: 50, height: 2,
        color: accentColor,
      });

      switch (slide.type) {
        case 'cover':
        case 'closing':
          renderCoverPage(page, slide, fontBold, fontRegular, fontSans, textColor, mutedColor, accentColor, lookBookData, PAGE_W, PAGE_H, MARGIN, CONTENT_W);
          break;
        case 'characters':
          renderCharactersPage(page, slide, fontBold, fontRegular, fontSansBold, fontSans, textColor, mutedColor, accentColor, PAGE_W, PAGE_H, MARGIN, CONTENT_W, isPortrait);
          break;
        case 'comparables':
          renderComparablesPage(page, slide, fontBold, fontRegular, fontSansBold, fontSans, textColor, mutedColor, accentColor, PAGE_W, PAGE_H, MARGIN, CONTENT_W, isPortrait);
          break;
        default:
          renderContentPage(page, slide, fontBold, fontRegular, fontSans, textColor, mutedColor, accentColor, PAGE_W, PAGE_H, MARGIN, CONTENT_W, isPortrait);
          break;
      }

      // Page number
      if (slide.type !== 'cover' && slide.type !== 'closing') {
        const pageNum = `${String(si + 1).padStart(2, '0')} / ${String(lookBookData.slides.length).padStart(2, '0')}`;
        page.drawText(pageNum, {
          x: PAGE_W - MARGIN - fontSans.widthOfTextAtSize(pageNum, 8),
          y: 30,
          size: 8,
          font: fontSans,
          color: mutedColor,
          opacity: 0.4,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    // Upload
    const storagePath = `${user.id}/${projectId}/${Date.now()}_lookbook.pdf`;
    const { error: uploadErr } = await sb.storage
      .from("exports")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: signedData } = await sb.storage
      .from("exports")
      .createSignedUrl(storagePath, 3600);

    return new Response(
      JSON.stringify({ signed_url: signedData?.signedUrl, storage_path: storagePath }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("export-lookbook-pdf error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Render functions ──

function renderCoverPage(
  page: PDFPage, slide: SlideContent,
  fontBold: PDFFont, fontRegular: PDFFont, fontSans: PDFFont,
  textColor: any, mutedColor: any, accentColor: any,
  data: LookBookData,
  PAGE_W: number, PAGE_H: number, MARGIN: number, CONTENT_W: number,
) {
  const title = slide.title || data.projectTitle;
  const titleSize = title.length > 20 ? 48 : 64;
  const titleLines = wrapText(title.toUpperCase(), fontBold, titleSize, CONTENT_W);
  const titleY = PAGE_H * 0.45;

  titleLines.forEach((line, i) => {
    page.drawText(line, {
      x: MARGIN,
      y: titleY - i * (titleSize * 1.2),
      size: titleSize,
      font: fontBold,
      color: textColor,
    });
  });

  if (slide.subtitle) {
    const subLines = wrapText(slide.subtitle, fontRegular, 16, CONTENT_W * 0.7);
    subLines.forEach((line, i) => {
      page.drawText(line, {
        x: MARGIN,
        y: titleY - titleLines.length * (titleSize * 1.2) - 20 - i * 22,
        size: 16,
        font: fontRegular,
        color: mutedColor,
      });
    });
  }

  // Credits
  if (slide.credit) {
    page.drawText(slide.credit, {
      x: MARGIN, y: 60,
      size: 10, font: fontSans, color: accentColor, opacity: 0.8,
    });
  }
  if (slide.companyName) {
    page.drawText(slide.companyName, {
      x: MARGIN, y: 42,
      size: 9, font: fontSans, color: mutedColor, opacity: 0.5,
    });
  }
}

function renderContentPage(
  page: PDFPage, slide: SlideContent,
  fontBold: PDFFont, fontRegular: PDFFont, fontSans: PDFFont,
  textColor: any, mutedColor: any, accentColor: any,
  PAGE_W: number, PAGE_H: number, MARGIN: number, CONTENT_W: number,
  isPortrait: boolean,
) {
  // Section label
  const label = (slide.type || '').replace(/_/g, ' ').toUpperCase();
  page.drawText(label, {
    x: MARGIN, y: PAGE_H - MARGIN - 20,
    size: 8, font: fontSans, color: accentColor, opacity: 0.7,
  });

  // Title
  const titleSize = isPortrait ? 32 : 36;
  page.drawText(slide.title || '', {
    x: MARGIN, y: PAGE_H - MARGIN - 60,
    size: titleSize, font: fontBold, color: textColor,
  });

  let cursorY = PAGE_H - MARGIN - 100;
  const bodyWidth = isPortrait ? CONTENT_W * 0.85 : CONTENT_W * 0.6;

  // Body
  if (slide.body) {
    const lines = wrapText(slide.body, fontRegular, 14, bodyWidth);
    for (const line of lines) {
      if (cursorY < 60) break;
      page.drawText(line, {
        x: MARGIN, y: cursorY,
        size: 14, font: fontRegular, color: textColor, opacity: 0.9,
      });
      cursorY -= 20;
    }
    cursorY -= 10;
  }

  // Body secondary
  if (slide.bodySecondary) {
    const lines = wrapText(slide.bodySecondary, fontRegular, 12, bodyWidth);
    for (const line of lines) {
      if (cursorY < 60) break;
      page.drawText(line, {
        x: MARGIN, y: cursorY,
        size: 12, font: fontRegular, color: mutedColor,
      });
      cursorY -= 18;
    }
  }

  // Bullets
  if (slide.bullets?.length) {
    let bulletY = isPortrait ? cursorY - 20 : PAGE_H - MARGIN - 100;
    const bulletX = isPortrait ? MARGIN : PAGE_W * 0.55;
    const bulletWidth = isPortrait ? CONTENT_W * 0.85 : CONTENT_W * 0.4;
    for (const bullet of slide.bullets) {
      if (bulletY < 60) break;
      page.drawCircle({
        x: bulletX, y: bulletY + 4,
        size: 2, color: accentColor,
      });
      const bLines = wrapText(bullet, fontRegular, 12, bulletWidth);
      for (const bl of bLines) {
        page.drawText(bl, {
          x: bulletX + 12, y: bulletY,
          size: 12, font: fontRegular, color: textColor, opacity: 0.85,
        });
        bulletY -= 18;
      }
      bulletY -= 6;
    }
  }

  // Quote
  if (slide.quote) {
    page.drawText(`"${slide.quote}"`, {
      x: MARGIN, y: 60,
      size: 11, font: fontRegular, color: mutedColor,
    });
  }
}

function renderCharactersPage(
  page: PDFPage, slide: SlideContent,
  fontBold: PDFFont, fontRegular: PDFFont,
  fontSansBold: PDFFont, fontSans: PDFFont,
  textColor: any, mutedColor: any, accentColor: any,
  PAGE_W: number, PAGE_H: number, MARGIN: number, CONTENT_W: number,
  isPortrait: boolean,
) {
  page.drawText('CHARACTERS', {
    x: MARGIN, y: PAGE_H - MARGIN - 20,
    size: 8, font: fontSans, color: accentColor, opacity: 0.7,
  });
  page.drawText(slide.title || 'Characters', {
    x: MARGIN, y: PAGE_H - MARGIN - 60,
    size: isPortrait ? 32 : 36, font: fontBold, color: textColor,
  });

  const chars = slide.characters || [];
  if (isPortrait) {
    // Portrait: single-column character stack
    chars.slice(0, 5).forEach((c, i) => {
      const y = PAGE_H - MARGIN - 120 - i * 180;
      if (y < 60) return;
      page.drawText(c.name, {
        x: MARGIN, y, size: 18, font: fontSansBold, color: accentColor,
      });
      if (c.role) {
        page.drawText(c.role.toUpperCase(), {
          x: MARGIN, y: y - 24, size: 8, font: fontSans, color: mutedColor,
        });
      }
      if (c.description) {
        const lines = wrapText(c.description, fontRegular, 11, CONTENT_W - 20);
        lines.slice(0, 6).forEach((line, li) => {
          page.drawText(line, {
            x: MARGIN, y: y - 44 - li * 16,
            size: 11, font: fontRegular, color: textColor, opacity: 0.85,
          });
        });
      }
    });
  } else {
    // Landscape: 2-col grid
    const colW = (CONTENT_W - 40) / 2;
    chars.slice(0, 4).forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MARGIN + col * (colW + 40);
      const y = PAGE_H - MARGIN - 120 - row * 200;

      page.drawText(c.name, {
        x, y, size: 18, font: fontSansBold, color: accentColor,
      });
      if (c.role) {
        page.drawText(c.role.toUpperCase(), {
          x, y: y - 24, size: 8, font: fontSans, color: mutedColor,
        });
      }
      if (c.description) {
        const lines = wrapText(c.description, fontRegular, 11, colW - 20);
        lines.slice(0, 5).forEach((line, li) => {
          page.drawText(line, {
            x, y: y - 44 - li * 16,
            size: 11, font: fontRegular, color: textColor, opacity: 0.85,
          });
        });
      }
    });
  }
}

function renderComparablesPage(
  page: PDFPage, slide: SlideContent,
  fontBold: PDFFont, fontRegular: PDFFont,
  fontSansBold: PDFFont, fontSans: PDFFont,
  textColor: any, mutedColor: any, accentColor: any,
  PAGE_W: number, PAGE_H: number, MARGIN: number, CONTENT_W: number,
  isPortrait: boolean,
) {
  page.drawText('MARKET POSITIONING', {
    x: MARGIN, y: PAGE_H - MARGIN - 20,
    size: 8, font: fontSans, color: accentColor, opacity: 0.7,
  });
  page.drawText(slide.title || 'Comparables', {
    x: MARGIN, y: PAGE_H - MARGIN - 60,
    size: isPortrait ? 32 : 36, font: fontBold, color: textColor,
  });

  const comps = slide.comparables || [];
  const spacing = isPortrait ? 120 : 100;
  comps.slice(0, isPortrait ? 6 : 4).forEach((c, i) => {
    const y = PAGE_H - MARGIN - 120 - i * spacing;
    if (y < 60) return;
    const num = String(i + 1).padStart(2, '0');
    page.drawText(num, {
      x: MARGIN, y, size: 28, font: fontBold, color: accentColor, opacity: 0.3,
    });
    page.drawText(c.title, {
      x: MARGIN + 50, y, size: 18, font: fontSansBold, color: textColor,
    });
    if (c.reason) {
      const lines = wrapText(c.reason, fontRegular, 11, CONTENT_W - 60);
      lines.slice(0, 3).forEach((line, li) => {
        page.drawText(line, {
          x: MARGIN + 50, y: y - 22 - li * 16,
          size: 11, font: fontRegular, color: mutedColor,
        });
      });
    }
  });
}
