/**
 * Coverage Report PDF Export
 * Generates a formatted PDF from a CoverageResult object.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CoverageResult } from '@/hooks/useScriptIntake';

const COLORS = {
  primary: [196, 145, 58] as [number, number, number],
  dark: [20, 21, 25] as [number, number, number],
  muted: [120, 115, 108] as [number, number, number],
  light: [245, 242, 237] as [number, number, number],
  success: [34, 160, 80] as [number, number, number],
  warning: [234, 179, 8] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

export function exportCoveragePDF(coverage: CoverageResult, scriptTitle: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const checkPage = (needed: number) => {
    if (y + needed > pageHeight - 15) {
      doc.addPage();
      y = margin;
    }
  };

  const sectionTitle = (title: string) => {
    checkPage(12);
    y += 3;
    doc.setFillColor(...COLORS.primary);
    doc.rect(margin, y, 18, 0.8, 'F');
    doc.setTextColor(...COLORS.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title, margin, y + 5);
    y += 9;
  };

  // ── Header ──
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 38, pageWidth, 1.2, 'F');

  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(margin, 8, 10, 10, 2, 2, 'F');
  doc.setTextColor(...COLORS.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('IF', margin + 3, 14.5);

  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Script Coverage Report', margin + 13, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.primary);
  doc.text(scriptTitle, margin, 28);

  doc.setTextColor(160, 155, 148);
  doc.setFontSize(7);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    pageWidth - margin, 33, { align: 'right' }
  );

  y = 46;

  // ── Scorecard ──
  const sc = coverage.scorecard;
  doc.setFillColor(...COLORS.light);
  doc.roundedRect(margin, y, contentWidth, 28, 2, 2, 'F');

  doc.setTextColor(...COLORS.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(`${sc.overall}`, margin + 6, y + 14);

  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.text(`/ 10  ·  ${sc.recommendation}`, margin + 6 + doc.getTextWidth(`${sc.overall}`) + 2, y + 14);

  // Score items
  const scores = [
    { label: 'Premise', val: sc.premise },
    { label: 'Structure', val: sc.structure },
    { label: 'Characters', val: sc.characters },
    { label: 'Dialogue', val: sc.dialogue },
    { label: 'Originality', val: sc.originality },
    { label: 'Commercial', val: sc.commercial_viability },
  ];
  const chipX = margin + 55;
  const chipSpacing = (contentWidth - 60) / scores.length;
  scores.forEach((s, i) => {
    const cx = chipX + i * chipSpacing;
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.muted);
    doc.text(s.label, cx, y + 8);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const color = s.val >= 8 ? COLORS.success : s.val >= 6 ? COLORS.dark : COLORS.warning;
    doc.setTextColor(...color);
    doc.text(`${s.val}`, cx, y + 15);
    doc.setFont('helvetica', 'normal');
  });

  if (coverage.confidence_summary?.overall) {
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Confidence: ${coverage.confidence_summary.overall}`, margin + 6, y + 24);
  }

  y += 32;

  // ── Loglines ──
  sectionTitle('Loglines');
  coverage.loglines.forEach((l, i) => {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);
    const lines = doc.splitTextToSize(`${i + 1}. ${l}`, contentWidth);
    const needed = lines.length * 3.5 + 2;
    checkPage(needed);
    doc.text(lines, margin, y);
    y += needed;
  });

  // ── One-Page Synopsis ──
  sectionTitle('One-Page Synopsis');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.dark);
  const synLines = doc.splitTextToSize(coverage.one_page_synopsis, contentWidth);
  synLines.forEach((line: string) => {
    checkPage(5);
    doc.text(line, margin, y);
    y += 3.5;
  });
  y += 2;

  // ── Comments ──
  if (coverage.comments) {
    sectionTitle('Comments');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);
    const cmtLines = doc.splitTextToSize(coverage.comments, contentWidth);
    cmtLines.forEach((line: string) => {
      checkPage(5);
      doc.text(line, margin, y);
      y += 3.5;
    });
    y += 2;
  }

  // ── Strengths & Weaknesses ──
  sectionTitle('Strengths');
  coverage.strengths.forEach(s => {
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(s, contentWidth - 6);
    const needed = lines.length * 3.5 + 1.5;
    checkPage(needed);
    doc.setTextColor(...COLORS.success);
    doc.text('✓', margin, y);
    doc.setTextColor(...COLORS.dark);
    doc.text(lines, margin + 5, y);
    y += needed;
  });

  sectionTitle('Weaknesses');
  coverage.weaknesses.forEach(w => {
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(w, contentWidth - 6);
    const needed = lines.length * 3.5 + 1.5;
    checkPage(needed);
    doc.setTextColor(...COLORS.warning);
    doc.text('⚠', margin, y);
    doc.setTextColor(...COLORS.dark);
    doc.text(lines, margin + 5, y);
    y += needed;
  });

  // ── Market Positioning ──
  sectionTitle('Market Positioning');
  const mp = coverage.market_positioning;
  const mpRows = [
    ['Comps', mp.comps.join(', ')],
    ['Audience', mp.audience],
    ['Platform Fit', mp.platform_fit],
    ['Budget Band', mp.budget_band],
    ['Risks', mp.risks.join('; ')],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: mpRows,
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 1.5, textColor: COLORS.dark },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28, textColor: COLORS.muted } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ── Craft & Structure ──
  sectionTitle('Craft & Structure');
  const cs = coverage.craft_structure;
  const csRows = [
    ['Act Breakdown', cs.act_breakdown],
    ['Turning Points', cs.turning_points.join('; ')],
    ['Pacing', cs.pacing_notes],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: csRows,
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 1.5, textColor: COLORS.dark },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30, textColor: COLORS.muted } },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Character arcs
  if (cs.character_arcs.length > 0) {
    checkPage(12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.muted);
    doc.text('Character Arcs', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Character', 'Arc', 'Pages']],
      body: cs.character_arcs.map(ca => [
        ca.character,
        ca.arc,
        ca.page_refs?.join(', ') || '—',
      ]),
      theme: 'striped',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 7 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── Scene Notes ──
  if (coverage.scene_notes.length > 0) {
    sectionTitle(`Scene Notes (${coverage.scene_notes.length})`);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Page', 'Scene', 'Note', 'Type']],
      body: coverage.scene_notes.map(sn => [
        `p.${sn.page}`,
        sn.scene_heading,
        sn.note,
        sn.strength_or_issue || '—',
      ]),
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.5, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 6.5 },
      columnStyles: { 0: { cellWidth: 12 }, 3: { cellWidth: 18 } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── Footer on last page ──
  doc.setFontSize(6);
  doc.setTextColor(180, 180, 180);
  doc.text('Generated by IFFY · Confidential', pageWidth / 2, pageHeight - 8, { align: 'center' });

  // Save
  const safeName = scriptTitle.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
  doc.save(`${safeName}_Coverage_${new Date().toISOString().slice(0, 10)}.pdf`);
}
