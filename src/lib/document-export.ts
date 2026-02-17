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

function buildPDF(text: string, title: string): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 14;
  let y = margin + 20;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 30;

  // Body
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(text, maxWidth);

  for (const line of lines) {
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
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
