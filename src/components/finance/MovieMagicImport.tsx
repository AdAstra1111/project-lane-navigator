import { useState, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileSpreadsheet, Loader2, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { read, utils } from '@e965/xlsx';
import { BUDGET_CATEGORIES, type ProjectBudgetLine } from '@/hooks/useBudgets';

interface MMLine {
  category: string;
  line_name: string;
  amount: number;
  account_code?: string;
}

// Movie Magic account code mapping
const ACCOUNT_MAP: Record<string, string> = {
  '1': 'atl', '10': 'atl', '11': 'atl', '12': 'atl', '13': 'atl', '14': 'atl', '15': 'atl',
  '2': 'btl', '20': 'btl', '21': 'btl', '22': 'btl', '23': 'btl', '24': 'btl', '25': 'btl', '26': 'btl', '27': 'btl', '28': 'btl', '29': 'btl',
  '3': 'post', '30': 'post', '31': 'post', '32': 'post', '33': 'post', '34': 'post',
  '4': 'vfx', '40': 'vfx', '41': 'vfx',
  '5': 'logistics', '50': 'logistics', '51': 'logistics', '52': 'logistics',
  '6': 'schedule', '60': 'schedule', '61': 'schedule',
  '7': 'contingency', '70': 'contingency',
  '8': 'soft-money', '80': 'soft-money', '81': 'soft-money',
};

function categorizeByCode(code: string): string {
  if (!code) return 'other';
  // Try exact match first
  if (ACCOUNT_MAP[code]) return ACCOUNT_MAP[code];
  // Try first 2 digits
  const prefix2 = code.slice(0, 2);
  if (ACCOUNT_MAP[prefix2]) return ACCOUNT_MAP[prefix2];
  // Try first digit
  const prefix1 = code.slice(0, 1);
  if (ACCOUNT_MAP[prefix1]) return ACCOUNT_MAP[prefix1];
  return 'other';
}

function categorizeByName(name: string): string {
  const lower = name.toLowerCase();
  if (/writer|director|producer|cast|actor|talent|star|above.the.line|atl/i.test(lower)) return 'atl';
  if (/crew|grip|electric|camera|sound|art|wardrobe|makeup|hair|below.the.line|btl|department/i.test(lower)) return 'btl';
  if (/post|edit|color|sound.mix|dub|score|music|composer/i.test(lower)) return 'post';
  if (/vfx|visual.effect|cgi|digital|composit/i.test(lower)) return 'vfx';
  if (/location|travel|transport|hotel|accomm|catering|per.diem|logistic/i.test(lower)) return 'logistics';
  if (/stage|studio|equip|camera.rental|lens|lighting.rental|schedule/i.test(lower)) return 'schedule';
  if (/contingency|reserve|buffer/i.test(lower)) return 'contingency';
  if (/tax.credit|rebate|incentive|soft.money|deferr|in.kind/i.test(lower)) return 'soft-money';
  return 'other';
}

function parseMovieMagicXLS(data: ArrayBuffer): MMLine[] {
  const workbook = read(data);
  const lines: MMLine[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = utils.sheet_to_json(sheet, { header: 1 });

    for (const row of rows) {
      if (!row || row.length < 2) continue;

      // Try to find account code, name, and amount
      let accountCode = '';
      let lineName = '';
      let amount = 0;

      for (const cell of row) {
        const str = String(cell || '').trim();
        if (!str) continue;

        // Check if it's a number (potential amount)
        const num = parseFloat(str.replace(/[$£€,\\s]/g, ''));
        if (!isNaN(num) && Math.abs(num) > 0 && str.match(/[\d.]+/)) {
          if (num > amount) amount = num;
          continue;
        }

        // Check if it's an account code (e.g., "1100", "2200")
        if (/^\d{2,4}$/.test(str) && !accountCode) {
          accountCode = str;
          continue;
        }

        // Otherwise treat as name
        if (!lineName && str.length > 1 && str.length < 200) {
          lineName = str;
        }
      }

      // Skip rows that look like headers, totals, or subtotals
      if (!lineName || amount <= 0) continue;
      if (/^(total|subtotal|grand total|page|date|prepared|budget)/i.test(lineName)) continue;

      const category = accountCode
        ? categorizeByCode(accountCode)
        : categorizeByName(lineName);

      lines.push({
        category,
        line_name: lineName,
        amount,
        account_code: accountCode || undefined,
      });
    }
  }

  // Deduplicate by name
  const seen = new Map<string, MMLine>();
  for (const line of lines) {
    const key = line.line_name.toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      existing.amount = Math.max(existing.amount, line.amount);
    } else {
      seen.set(key, line);
    }
  }

  return Array.from(seen.values());
}

interface Props {
  onImport: (lines: { category: string; line_name: string; amount: number }[]) => void;
  disabled?: boolean;
}

export function MovieMagicImport({ onImport, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<MMLine[] | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    try {
      const ext = file.name.toLowerCase().split('.').pop();

      if (ext === 'csv' || ext === 'txt') {
        // CSV parsing
        const text = await file.text();
        const rows = text.trim().split('\n');
        const lines: MMLine[] = [];
        for (let i = 0; i < rows.length; i++) {
          const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          if (i === 0 && cols.some(c => /account|name|description|amount|total/i.test(c))) continue;

          let name = '';
          let amount = 0;
          let code = '';

          for (const col of cols) {
            const num = parseFloat(col.replace(/[$£€,\s]/g, ''));
            if (!isNaN(num) && Math.abs(num) > 0 && col.match(/[\d.]+/)) {
              if (num > amount) amount = num;
            } else if (/^\d{2,4}$/.test(col) && !code) {
              code = col;
            } else if (col.length > 1 && col.length < 200 && !name) {
              name = col;
            }
          }

          if (name && amount > 0) {
            lines.push({
              category: code ? categorizeByCode(code) : categorizeByName(name),
              line_name: name,
              amount,
              account_code: code || undefined,
            });
          }
        }
        if (lines.length === 0) throw new Error('No budget lines found in file');
        setPreview(lines);
      } else {
        // XLS/XLSX parsing
        const data = await file.arrayBuffer();
        const lines = parseMovieMagicXLS(data);
        if (lines.length === 0) throw new Error('No budget lines found in file');
        setPreview(lines);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to parse file');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirm = () => {
    if (!preview) return;
    onImport(preview.map(l => ({ category: l.category, line_name: l.line_name, amount: l.amount })));
    setPreview(null);
    toast.success(`Imported ${preview.length} line items`);
  };

  const total = preview?.reduce((s, l) => s + l.amount, 0) || 0;

  const byCategory = useMemo(() => {
    if (!preview) return {};
    const cats: Record<string, { total: number; count: number }> = {};
    for (const l of preview) {
      if (!cats[l.category]) cats[l.category] = { total: 0, count: 0 };
      cats[l.category].total += l.amount;
      cats[l.category].count += 1;
    }
    return cats;
  }, [preview]);

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv,.txt" className="hidden" onChange={handleFile} />

      {!preview && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || importing}
          className="text-xs gap-1.5"
        >
          {importing ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Reading…</>
          ) : (
            <><FileSpreadsheet className="h-3 w-3" /> Import Movie Magic</>
          )}
        </Button>
      )}

      {preview && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 bg-muted/20 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Import Preview</span>
            </div>
            <Badge className="text-[10px]">{preview.length} lines</Badge>
          </div>

          <div className="text-xs text-muted-foreground">
            Total: <span className="font-medium text-foreground">${total.toLocaleString()}</span>
          </div>

          {/* Category breakdown */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byCategory).sort(([, a], [, b]) => b.total - a.total).map(([cat, { total: catTotal, count }]) => (
              <Badge key={cat} variant="outline" className="text-[10px]">
                {BUDGET_CATEGORIES.find(b => b.value === cat)?.label || cat}: {count} items (${catTotal.toLocaleString()})
              </Badge>
            ))}
          </div>

          {/* Line preview (first 8) */}
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {preview.slice(0, 8).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground w-8 shrink-0">{l.account_code || '—'}</span>
                <span className="text-foreground flex-1 truncate">{l.line_name}</span>
                <span className="text-foreground font-medium">${l.amount.toLocaleString()}</span>
              </div>
            ))}
            {preview.length > 8 && (
              <p className="text-[10px] text-muted-foreground">…and {preview.length - 8} more</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleConfirm} className="text-xs gap-1.5">
              <Check className="h-3 w-3" /> Import {preview.length} Lines
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
