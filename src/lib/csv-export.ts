/**
 * CSV Export utilities for project data.
 */

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function toCSV(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map(row => row.map(escapeCSV).join(','));
  return [headerLine, ...dataLines].join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportDealsCSV(deals: any[], projectTitle: string) {
  const headers = ['Territory', 'Buyer', 'Deal Type', 'Status', 'Amount', 'Currency', 'Notes', 'Offered At', 'Closed At'];
  const rows = deals.map(d => [
    d.territory || '',
    d.buyer_name || '',
    d.deal_type || '',
    d.status || '',
    d.minimum_guarantee || '',
    d.currency || 'USD',
    d.notes || '',
    d.offered_at ? new Date(d.offered_at).toLocaleDateString() : '',
    d.closed_at ? new Date(d.closed_at).toLocaleDateString() : '',
  ]);
  const safeName = projectTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  downloadCSV(toCSV(headers, rows), `${safeName}_deals.csv`);
}

export function exportDeliverablesCSV(deliverables: any[], projectTitle: string) {
  const headers = ['Item', 'Territory', 'Buyer', 'Type', 'Status', 'Format Spec', 'Due Date', 'Notes'];
  const rows = deliverables.map(d => [
    d.item_name || '',
    d.territory || '',
    d.buyer_name || '',
    d.deliverable_type || '',
    d.status || '',
    d.format_spec || '',
    d.due_date ? new Date(d.due_date).toLocaleDateString() : '',
    d.notes || '',
  ]);
  const safeName = projectTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  downloadCSV(toCSV(headers, rows), `${safeName}_deliverables.csv`);
}

export function exportCostsCSV(costs: any[], projectTitle: string) {
  const headers = ['Date', 'Category', 'Description', 'Vendor', 'Amount', 'Receipt Ref', 'Notes'];
  const rows = costs.map(c => [
    c.entry_date ? new Date(c.entry_date).toLocaleDateString() : '',
    c.category || '',
    c.description || '',
    c.vendor || '',
    String(c.amount || 0),
    c.receipt_ref || '',
    c.notes || '',
  ]);
  const safeName = projectTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  downloadCSV(toCSV(headers, rows), `${safeName}_costs.csv`);
}

export function exportBudgetCSV(lines: any[], budgetLabel: string, projectTitle: string) {
  const headers = ['Category', 'Line Name', 'Amount', 'Notes'];
  const rows = lines.map(l => [
    l.category || '',
    l.line_name || '',
    String(l.amount || 0),
    l.notes || '',
  ]);
  const safeName = projectTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  downloadCSV(toCSV(headers, rows), `${safeName}_budget_${budgetLabel.replace(/\s/g, '_')}.csv`);
}
