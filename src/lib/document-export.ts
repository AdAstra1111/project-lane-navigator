/**
 * Document export utility — download document text as various file formats.
 */
import jsPDF from 'jspdf';

export type ExportFormat = 'md' | 'txt' | 'pdf' | 'fountain';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  md: 'Markdown (.md)',
  txt: 'Plain Text (.txt)',
  pdf: 'PDF (.pdf)',
  fountain: 'Fountain (.fountain)',
};

const MIME_TYPES: Record<ExportFormat, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  pdf: 'application/pdf',
  fountain: 'text/plain',
};

export function getExportFormats(): { value: ExportFormat; label: string }[] {
  return Object.entries(FORMAT_LABELS).map(([value, label]) => ({
    value: value as ExportFormat,
    label,
  }));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'document';
}

const PDF_COLORS = {
  primary: [196, 145, 58] as [number, number, number],
  dark: [20, 21, 25] as [number, number, number],
  muted: [120, 115, 108] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

function buildPDF(text: string, title: string): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const bodyLineHeight = 4.2;
  const footerY = pageHeight - 10;
  let y = 0;

  // Detect document type from title (e.g. "My Project — Character Bible" → "Character Bible")
  const dashIdx = title.lastIndexOf('—');
  const colonIdx = title.lastIndexOf(':');
  const sepIdx = Math.max(dashIdx, colonIdx);
  const docType = sepIdx > 0 ? title.slice(sepIdx + 1).trim() : 'Document';
  const projectTitle = sepIdx > 0 ? title.slice(0, sepIdx).trim() : title;
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const drawHeader = (isFirst: boolean) => {
    // Dark header band
    doc.setFillColor(...PDF_COLORS.dark);
    doc.rect(0, 0, pageWidth, isFirst ? 38 : 14, 'F');
    // Amber accent stripe
    doc.setFillColor(...PDF_COLORS.primary);
    doc.rect(0, isFirst ? 38 : 14, pageWidth, 0.8, 'F');

    if (isFirst) {
      // IF logo mark
      doc.setFillColor(...PDF_COLORS.primary);
      doc.roundedRect(margin, 7, 9, 9, 2, 2, 'F');
      doc.setTextColor(...PDF_COLORS.dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.text('IF', margin + 2.8, 12.8);

      // Project title
      doc.setTextColor(...PDF_COLORS.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(projectTitle, margin + 12, 15);

      // Document type in amber
      doc.setTextColor(...PDF_COLORS.primary);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(docType, margin, 28);

      // Date top-right
      doc.setTextColor(160, 155, 148);
      doc.setFontSize(7);
      doc.text(dateStr, pageWidth - margin, 33, { align: 'right' });
    } else {
      // Continuation pages: compact brand + title
      doc.setFillColor(...PDF_COLORS.primary);
      doc.roundedRect(margin, 3.5, 7, 7, 1.5, 1.5, 'F');
      doc.setTextColor(...PDF_COLORS.dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.5);
      doc.text('IF', margin + 2, 8);

      doc.setTextColor(...PDF_COLORS.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(projectTitle, margin + 10, 8.5);
    }
  };

  const drawFooter = (pageNum: number, totalPages: number) => {
    // Amber rule
    doc.setDrawColor(...PDF_COLORS.primary);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY - 2, pageWidth - margin, footerY - 2);
    // Left text
    doc.setTextColor(...PDF_COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text('IFFY \u2014 Intelligent Film Flow & Yield', margin, footerY + 1);
    // Right page number
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, footerY + 1, { align: 'right' });
  };

  // ── Parse text into blocks ──
  interface Block { type: 'h1' | 'h2' | 'hr' | 'text'; content: string }
  const blocks: Block[] = [];
  const rawLines = text.split('\n');
  let textBuf = '';

  const flushText = () => {
    if (textBuf.trim()) {
      blocks.push({ type: 'text', content: textBuf.trimEnd() });
    }
    textBuf = '';
  };

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (/^---+$/.test(trimmed) || /^___+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushText();
      blocks.push({ type: 'hr', content: '' });
    } else if (/^## /.test(trimmed)) {
      flushText();
      blocks.push({ type: 'h2', content: trimmed.replace(/^## /, '') });
    } else if (/^# /.test(trimmed)) {
      flushText();
      blocks.push({ type: 'h1', content: trimmed.replace(/^# /, '') });
    } else {
      textBuf += raw + '\n';
    }
  }
  flushText();

  // ── Render blocks ──
  drawHeader(true);
  y = 44;

  const checkPage = (needed: number) => {
    if (y + needed > footerY - 4) {
      doc.addPage();
      drawHeader(false);
      y = 19;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'h1': {
        checkPage(10);
        y += 3;
        doc.setFillColor(...PDF_COLORS.primary);
        doc.rect(margin, y, 16, 0.7, 'F');
        doc.setTextColor(...PDF_COLORS.primary);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(block.content, margin, y + 6);
        y += 10;
        break;
      }
      case 'h2': {
        checkPage(8);
        y += 2;
        doc.setTextColor(...PDF_COLORS.dark);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.text(block.content, margin, y + 4.5);
        y += 8;
        break;
      }
      case 'hr': {
        checkPage(5);
        y += 2;
        doc.setDrawColor(...PDF_COLORS.primary);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 3;
        break;
      }
      case 'text': {
        doc.setTextColor(...PDF_COLORS.dark);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const wrapped = doc.splitTextToSize(block.content, contentWidth);
        for (const wline of wrapped) {
          checkPage(bodyLineHeight + 1);
          doc.text(wline, margin, y);
          y += bodyLineHeight;
        }
        y += 1.5;
        break;
      }
    }
  }

  // ── Draw footers on every page ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  return doc.output('blob');
}

export function downloadDocument(
  text: string,
  title: string,
  format: ExportFormat,
) {
  const filename = sanitizeFilename(title);

  let blob: Blob;
  let ext = format as string;

  switch (format) {
    case 'pdf':
      blob = buildPDF(text, title);
      break;
    case 'fountain':
      blob = new Blob([text], { type: MIME_TYPES.fountain });
      break;
    case 'md':
      blob = new Blob([text], { type: MIME_TYPES.md });
      break;
    case 'txt':
    default:
      blob = new Blob([text], { type: MIME_TYPES.txt });
      ext = 'txt';
      break;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
