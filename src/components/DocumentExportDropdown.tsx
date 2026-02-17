/**
 * DocumentExportDropdown — Reusable dropdown for exporting document text in various formats.
 */
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadDocument, getExportFormats, type ExportFormat } from '@/lib/document-export';
import { toast } from 'sonner';

interface DocumentExportDropdownProps {
  text: string;
  title: string;
  /** Button size variant */
  size?: 'sm' | 'default';
  /** Extra class for the trigger button */
  className?: string;
  /** Show label text next to icon */
  showLabel?: boolean;
}

export function DocumentExportDropdown({
  text,
  title,
  size = 'sm',
  className = '',
  showLabel = true,
}: DocumentExportDropdownProps) {
  const formats = getExportFormats();

  const handleExport = (format: ExportFormat) => {
    if (!text?.trim()) {
      toast.error('No content to export');
      return;
    }
    downloadDocument(text, title, format);
    toast.success(`Exported as ${format.toUpperCase()}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={`gap-1 ${size === 'sm' ? 'h-7 text-[10px]' : 'h-8 text-xs'} ${className}`}
          disabled={!text?.trim()}
        >
          <Download className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          {showLabel && 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {formats.map(f => (
          <DropdownMenuItem key={f.value} onClick={() => handleExport(f.value)} className="text-xs">
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
