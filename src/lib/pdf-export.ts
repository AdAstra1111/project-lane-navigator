/**
 * PDF One-Pager Export
 * Generates a polished project overview document using jsPDF.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project, FullAnalysis, MonetisationLane } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import type { FinanceReadinessResult } from '@/lib/finance-readiness';
import type { ProjectCastMember, ProjectPartner, ProjectFinanceScenario, ProjectHOD } from '@/hooks/useProjectAttachments';
import type { BuyerMatch } from '@/lib/buyer-matcher';
import type { ProjectDeal } from '@/hooks/useDeals';
import { getCategoryForDealType, DEAL_TYPES_BY_CATEGORY } from '@/hooks/useDeals';
import { BUDGET_RANGES, TARGET_AUDIENCES, TONES } from '@/lib/constants';
import { LANE_LABELS } from '@/lib/types';

interface ExportData {
  project: Project;
  readiness: ReadinessResult | null;
  financeReadiness?: FinanceReadinessResult | null;
  cast: ProjectCastMember[];
  partners: ProjectPartner[];
  hods: ProjectHOD[];
  financeScenarios: ProjectFinanceScenario[];
  buyerMatches: BuyerMatch[];
  deals?: ProjectDeal[];
  deliverables?: { item_name: string; territory: string; buyer_name: string; status: string; deliverable_type: string }[];
  costSummary?: { totalSpent: number; totalBudget: number; burnRate: number };
}

const COLORS = {
  primary: [196, 145, 58] as [number, number, number],       // amber gold #C4913A
  dark: [20, 21, 25] as [number, number, number],             // charcoal #141519
  muted: [120, 115, 108] as [number, number, number],         // warm grey
  light: [245, 242, 237] as [number, number, number],         // warm off-white
  success: [34, 160, 80] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const getLabel = (value: string, list: readonly { value: string; label: string }[]) =>
  list.find(item => item.value === value)?.label || value;

export function exportProjectPDF(data: ExportData) {
  const { project, readiness, financeReadiness, cast, partners, hods, financeScenarios, buyerMatches, deals, deliverables, costSummary } = data;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const checkPage = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      y = margin;
    }
  };

  // ---- Header Band ----
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, pageWidth, 42, 'F');

  // Accent stripe
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 42, pageWidth, 1.2, 'F');

  // Brand mark
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(margin, 8, 10, 10, 2, 2, 'F');
  doc.setTextColor(...COLORS.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('IF', margin + 3, 14.5);

  // Brand name
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('IFFY', margin + 13, 14);

  // Project title
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(project.title, margin, 28);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.primary);
  const subtitleParts = [
    project.format === 'tv-series' ? 'TV Series' : 'Film',
    ...(project.genres || []),
  ];
  doc.text(subtitleParts.join(' \u00B7 '), margin, 34);

  // Lane badge
  if (project.assigned_lane) {
    const laneLabel = LANE_LABELS[project.assigned_lane as MonetisationLane] || project.assigned_lane;
    const laneW = doc.getTextWidth(laneLabel) + 8;
    doc.setFillColor(...COLORS.primary);
    doc.roundedRect(pageWidth - margin - laneW, 8, laneW, 6, 1.5, 1.5, 'F');
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(laneLabel, pageWidth - margin - laneW + 4, 12.5);
  }

  // Date
  doc.setTextColor(160, 155, 148);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, pageWidth - margin, 37, { align: 'right' });

  y = 50;

  // ---- Readiness Score ----
  if (readiness) {
    checkPage(28);
    doc.setFillColor(...COLORS.light);
    doc.roundedRect(margin, y, contentWidth, 24, 2, 2, 'F');

    doc.setTextColor(...COLORS.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text(`${readiness.score}`, margin + 6, y + 14);

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(`/ 100  ·  ${readiness.stage}`, margin + 6 + doc.getTextWidth(`${readiness.score}`) + 2, y + 14);

    // Breakdown bars
    const barX = margin + 55;
    const barW = contentWidth - 60;
    const bars = [
      { label: 'Script', val: readiness.breakdown.script, max: 25 },
      { label: 'Packaging', val: readiness.breakdown.packaging, max: 30 },
      { label: 'Finance', val: readiness.breakdown.finance, max: 25 },
      { label: 'Market', val: readiness.breakdown.market, max: 20 },
    ];
    bars.forEach((b, i) => {
      const by = y + 4 + i * 5;
      doc.setFontSize(6);
      doc.setTextColor(...COLORS.muted);
      doc.text(b.label, barX, by + 3);
      doc.setFillColor(220, 225, 235);
      doc.roundedRect(barX + 22, by, barW - 22, 3, 1, 1, 'F');
      doc.setFillColor(...COLORS.primary);
      doc.roundedRect(barX + 22, by, ((barW - 22) * b.val) / b.max, 3, 1, 1, 'F');
    });

    y += 28;
  }

  // ---- Finance Readiness ----
  if (financeReadiness) {
    checkPage(30);
    y += 2;
    sectionTitle(doc, 'Finance Readiness', margin, y);
    y += 7;

    doc.setFillColor(...COLORS.light);
    doc.roundedRect(margin, y, contentWidth, 22, 2, 2, 'F');

    doc.setTextColor(...COLORS.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(`${financeReadiness.score}`, margin + 6, y + 12);

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.setFont('helvetica', 'normal');
    const frLabel = financeReadiness.score >= 80 ? 'Finance-Ready' : financeReadiness.score >= 60 ? 'Approaching' : financeReadiness.score >= 35 ? 'Building' : 'Early Stage';
    doc.text(`/ 100  ·  ${frLabel}  ·  Volatility: ${financeReadiness.volatilityIndex}  ·  ${financeReadiness.geographySensitivity}`, margin + 6 + doc.getTextWidth(`${financeReadiness.score}`) + 2, y + 12);

    y += 24;

    // Budget bands row
    const bandW = (contentWidth - 6) / 3;
    (['low', 'target', 'stretch'] as const).forEach((key, i) => {
      const band = financeReadiness.budgetBands[key];
      const bx = margin + i * (bandW + 3);
      const labels = { low: 'Low', target: 'Target', stretch: 'Stretch' };
      doc.setFillColor(key === 'target' ? 230 : 245, key === 'target' ? 240 : 248, 255);
      doc.roundedRect(bx, y, bandW, 12, 1, 1, 'F');
      doc.setTextColor(...COLORS.muted);
      doc.setFontSize(6);
      doc.text(labels[key].toUpperCase(), bx + bandW / 2, y + 4, { align: 'center' });
      doc.setTextColor(...COLORS.dark);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(band.rangeHint, bx + bandW / 2, y + 9.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    });
    y += 15;

    // Top risk flags
    if (financeReadiness.riskFlags.length > 0) {
      const topFlags = financeReadiness.riskFlags.slice(0, 3);
      topFlags.forEach(flag => {
        checkPage(8);
        doc.setTextColor(239, 68, 68);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text(`⚠ ${flag.tag}`, margin, y);
        doc.setTextColor(...COLORS.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        const flagLines = doc.splitTextToSize(flag.explanation, contentWidth - 4);
        doc.text(flagLines, margin + 2, y + 3.5);
        y += flagLines.length * 3 + 5;
      });
    }
    y += 2;
  }

  // ---- IFFY Verdict ----
  const analysis = project.analysis_passes as FullAnalysis | null;
  if (analysis?.verdict) {
    checkPage(16);
    y += 4;
    doc.setFillColor(240, 245, 255);
    const verdictLines = doc.splitTextToSize(analysis.verdict, contentWidth - 12);
    const blockH = Math.max(12, verdictLines.length * 4 + 8);
    doc.roundedRect(margin, y, contentWidth, blockH, 2, 2, 'F');
    doc.setDrawColor(...COLORS.primary);
    doc.setLineWidth(0.6);
    doc.line(margin, y, margin, y + blockH);

    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('IFFY VERDICT', margin + 5, y + 5);

    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(verdictLines, margin + 5, y + 10);
    y += blockH + 4;
  }

  // ---- Project Details ----
  checkPage(22);
  y += 2;
  sectionTitle(doc, 'Project Details', margin, y);
  y += 7;

  const details = [
    ['Budget', getLabel(project.budget_range, BUDGET_RANGES)],
    ['Audience', getLabel(project.target_audience, TARGET_AUDIENCES)],
    ['Tone', getLabel(project.tone, TONES)],
  ];
  if (project.comparable_titles) details.push(['Comparables', project.comparable_titles]);
  if (project.confidence != null) details.push(['Confidence', `${Math.round(project.confidence * 100)}%`]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: details,
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 1.5, textColor: COLORS.dark },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 28, textColor: COLORS.muted },
    },
    didDrawPage: () => {},
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ---- Key Team ----
  const attachedCast = cast.filter(c => c.status === 'attached' || c.status === 'interested');
  const keyHods = hods.filter(h => h.status === 'attached' || h.status === 'confirmed');
  const teamRows = [
    ...keyHods.map(h => [h.department, h.person_name, h.reputation_tier]),
    ...attachedCast.map(c => [`Cast (${c.role_name || 'Lead'})`, c.actor_name, c.status]),
  ];

  if (teamRows.length > 0) {
    checkPage(20);
    sectionTitle(doc, 'Key Team', margin, y);
    y += 7;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Role', 'Name', 'Status']],
      body: teamRows,
      theme: 'striped',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 7 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Partners ----
  const activePartners = partners.filter(p => p.status !== 'identified');
  if (activePartners.length > 0) {
    checkPage(18);
    sectionTitle(doc, 'Partners & Sales', margin, y);
    y += 7;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Company', 'Type', 'Territory', 'Status']],
      body: activePartners.map(p => [p.partner_name, p.partner_type, p.territory || '—', p.status]),
      theme: 'striped',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 7 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Finance Scenario ----
  if (financeScenarios.length > 0) {
    checkPage(24);
    sectionTitle(doc, 'Finance Plan', margin, y);
    y += 7;

    const fin = financeScenarios[0]; // Show primary scenario
    const finRows = [
      ['Total Budget', fin.total_budget || '—'],
      ['Incentives', fin.incentive_amount || '—'],
      ['Pre-Sales', fin.presales_amount || '—'],
      ['Equity', fin.equity_amount || '—'],
      ['Gap', fin.gap_amount || '—'],
      ['Other', fin.other_sources || '—'],
    ].filter(r => r[1] !== '—');

    if (fin.scenario_name) {
      doc.setTextColor(...COLORS.muted);
      doc.setFontSize(7);
      doc.text(`Scenario: ${fin.scenario_name}  ·  Confidence: ${fin.confidence}`, margin, y);
      y += 4;
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: finRows,
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.5, textColor: COLORS.dark },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 28, textColor: COLORS.muted },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Top Buyer Matches ----
  if (buyerMatches.length > 0) {
    checkPage(22);
    sectionTitle(doc, 'Top Buyer Matches', margin, y);
    y += 7;

    const topBuyers = buyerMatches.slice(0, 5);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Company', 'Type', 'Score', 'Why']],
      body: topBuyers.map(b => [
        b.buyerName,
        b.companyType,
        `${b.score}%`,
        b.matchReasons.slice(0, 2).join('; '),
      ]),
      theme: 'striped',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 7 },
      columnStyles: { 2: { cellWidth: 14 } },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Do Next / Avoid ----
  if (analysis?.do_next && analysis.do_next.length > 0) {
    checkPage(20);
    sectionTitle(doc, 'Recommended Next Steps', margin, y);
    y += 7;

    analysis.do_next.forEach((item, i) => {
      checkPage(6);
      doc.setTextColor(...COLORS.success);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}.`, margin, y);
      doc.setTextColor(...COLORS.dark);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(item, contentWidth - 8);
      doc.text(lines, margin + 6, y);
      y += lines.length * 3.5 + 2;
    });
    y += 2;
  }

  if (analysis?.avoid && analysis.avoid.length > 0) {
    checkPage(16);
    sectionTitle(doc, 'Avoid', margin, y);
    y += 7;

    analysis.avoid.forEach((item, i) => {
      checkPage(6);
      doc.setTextColor(239, 68, 68);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}.`, margin, y);
      doc.setTextColor(...COLORS.dark);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(item, contentWidth - 8);
      doc.text(lines, margin + 6, y);
      y += lines.length * 3.5 + 2;
    });
  }

  // ---- Deal Summary ----
  if (deals && deals.length > 0) {
    checkPage(24);
    y += 2;
    sectionTitle(doc, 'Deal Summary', margin, y);
    y += 7;

    const closedDeals = deals.filter(d => d.status === 'closed');
    const pipelineDeals = deals.filter(d => !['closed', 'passed'].includes(d.status));
    const closedTotal = closedDeals.reduce((s, d) => s + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);
    const pipelineTotal = pipelineDeals.reduce((s, d) => s + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);
    doc.text(`Closed: ${closedDeals.length} deals ($${closedTotal.toLocaleString()})  ·  Pipeline: ${pipelineDeals.length} deals ($${pipelineTotal.toLocaleString()})`, margin, y);
    y += 5;

    const dealRows = deals.slice(0, 15).map(d => {
      const cat = getCategoryForDealType(d.deal_type);
      const typeLabel = DEAL_TYPES_BY_CATEGORY[cat]?.find(t => t.value === d.deal_type)?.label || d.deal_type;
      return [d.territory || '—', d.buyer_name || '—', typeLabel, d.minimum_guarantee || '—', d.status];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Territory', 'Buyer', 'Type', 'Amount', 'Status']],
      body: dealRows,
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.5, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 6.5 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Deliverables ----
  if (deliverables && deliverables.length > 0) {
    checkPage(20);
    sectionTitle(doc, 'Deliverables', margin, y);
    y += 7;

    const completed = deliverables.filter(d => d.status === 'completed' || d.status === 'waived').length;
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);
    doc.text(`${completed} / ${deliverables.length} complete (${deliverables.length > 0 ? Math.round((completed / deliverables.length) * 100) : 0}%)`, margin, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Item', 'Territory', 'Buyer', 'Type', 'Status']],
      body: deliverables.slice(0, 15).map(d => [d.item_name || '—', d.territory || '—', d.buyer_name || '—', d.deliverable_type, d.status]),
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.5, textColor: COLORS.dark },
      headStyles: { fillColor: COLORS.dark, textColor: COLORS.white, fontSize: 6.5 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ---- Cost Summary ----
  if (costSummary && costSummary.totalSpent > 0) {
    checkPage(14);
    sectionTitle(doc, 'Cost Summary', margin, y);
    y += 7;

    const burnPct = costSummary.totalBudget > 0 ? Math.round((costSummary.totalSpent / costSummary.totalBudget) * 100) : 0;
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);
    doc.text(`Total Spent: $${costSummary.totalSpent.toLocaleString()}  ·  Budget: $${costSummary.totalBudget.toLocaleString()}  ·  Burn: ${burnPct}%  ·  Weekly Rate: $${Math.round(costSummary.burnRate).toLocaleString()}/wk`, margin, y);
    y += 6;
  }

  // ---- Footer ----
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    // Footer line
    doc.setDrawColor(...COLORS.primary);
    doc.setLineWidth(0.3);
    doc.line(margin, doc.internal.pageSize.getHeight() - 10, pageWidth - margin, doc.internal.pageSize.getHeight() - 10);
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.muted);
    doc.text('IFFY \u2014 Intelligent Film Flow & Yield', margin, doc.internal.pageSize.getHeight() - 6);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }

  // Save
  const safeName = project.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  doc.save(`${safeName}_one_pager.pdf`);
}

function sectionTitle(doc: jsPDF, text: string, x: number, y: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.primary);
  doc.text(text.toUpperCase(), x, y);
  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(0.4);
  doc.line(x, y + 1.5, x + doc.getTextWidth(text.toUpperCase()) + 2, y + 1.5);
}
