/**
 * EpisodePackagePanel — Quick actions for episode packaging and season binder export.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Download, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  lockedEpisodeCount: number;
  totalEpisodes: number;
  onExportBinder: () => Promise<void>;
}

export function EpisodePackagePanel({ lockedEpisodeCount, totalEpisodes, onExportBinder }: Props) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExportBinder();
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 px-4 pt-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-primary" />
          Season Package
          <Badge variant="outline" className="text-[8px] ml-auto">
            {lockedEpisodeCount}/{totalEpisodes} packaged
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <div className="text-xs text-muted-foreground">
          Each locked episode exports a package folder with script, continuity ledger, and compliance report.
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
            disabled={exporting || lockedEpisodeCount === 0}
          >
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Export Season Binder
          </Button>
        </div>

        {lockedEpisodeCount > 0 && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Package path: projects/&#123;id&#125;/package/episodes/EP&#123;NN&#125;/
          </div>
        )}
      </CardContent>
    </Card>
  );
}
