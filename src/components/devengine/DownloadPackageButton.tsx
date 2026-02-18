/**
 * DownloadPackageButton — split button with Server ZIP (recommended), Quick ZIP (browser),
 * and Merged PDF options.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Download, ChevronDown, Server, Monitor, Loader2, AlertTriangle, FileText,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import JSZip from 'jszip';
import type { ProjectPackage } from '@/hooks/useProjectPackage';

type Scope = 'approved_preferred' | 'approved_only' | 'latest_only';

interface Props {
  projectId: string;
  format: string;
  /** The resolver output — used by Quick ZIP as SSOT */
  pkg: ProjectPackage;
}

const SCOPE_LABELS: Record<Scope, string> = {
  approved_preferred: 'Approved preferred (default)',
  approved_only: 'Approved only',
  latest_only: 'Latest only',
};

export function DownloadPackageButton({ projectId, format, pkg }: Props) {
  const [scope, setScope] = useState<Scope>('approved_preferred');
  const [includeMasterScript, setIncludeMasterScript] = useState(true);

  // ── SERVER ZIP ──
  const serverZip = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('export-package', {
        body: {
          projectId,
          scope,
          include_master_script: includeMasterScript,
          expiresInSeconds: 3600,
          output_format: 'zip',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { signed_url: string; doc_count: number };
    },
    onSuccess: (data) => {
      const a = document.createElement('a');
      a.href = data.signed_url;
      a.download = 'project_package.zip';
      a.click();
      toast.success(`Package ready — ${data.doc_count} documents`);
    },
    onError: (err: any) => {
      toast.error('Server export failed: ' + (err.message || 'Unknown error'));
    },
  });

  // ── SERVER PDF ──
  const serverPdf = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('export-package', {
        body: {
          projectId,
          scope,
          include_master_script: includeMasterScript,
          expiresInSeconds: 3600,
          output_format: 'pdf',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { signed_url: string; doc_count: number };
    },
    onSuccess: (data) => {
      const a = document.createElement('a');
      a.href = data.signed_url;
      a.download = `project_package_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      toast.success(`PDF ready — ${data.doc_count} documents merged`);
    },
    onError: (err: any) => {
      toast.error('PDF export failed: ' + (err.message || 'Unknown error'));
    },
  });

  // ── QUICK ZIP (client-side, uses pkg resolver data) ──
  const quickZip = useMutation({
    mutationFn: async () => {
      const zip = new JSZip();
      const metaDocs: any[] = [];
      let docCount = 0;

      // Build ordered list from resolver
      const ladder = pkg.ladder;

      // We need plaintext — fetch it for the selected versions
      const versionIds: string[] = [];

      // Collect version IDs based on scope from resolver data
      const deliverablesToExport = pkg.deliverables.filter(
        d => includeMasterScript || d.deliverable_type !== 'season_master_script'
      );
      const seasonScriptsToExport = includeMasterScript ? pkg.season_scripts : [];

      // For approved_only scope: only include approved items
      const filteredDeliverables = scope === 'approved_only'
        ? deliverablesToExport.filter(d => d.is_approved)
        : deliverablesToExport;

      const filteredSeasonScripts = scope === 'approved_only'
        ? seasonScriptsToExport.filter(s => s.is_approved)
        : seasonScriptsToExport;

      for (const d of filteredDeliverables) versionIds.push(d.version_id);
      for (const s of filteredSeasonScripts) versionIds.push(s.version_id);

      if (versionIds.length === 0) throw new Error('No documents available with the selected scope');

      // Fetch plaintext for all version IDs
      const { data: versions } = await (supabase as any)
        .from('project_document_versions')
        .select('id, plaintext, status')
        .in('id', versionIds);

      const plaintextMap = new Map<string, string>(
        (versions || []).map((v: any) => [v.id, v.plaintext || ''])
      );

      // Build ZIP in ladder order
      let orderIdx = 1;
      for (const docType of ladder) {
        if (docType === 'season_master_script') {
          // Handle season scripts
          for (const ss of filteredSeasonScripts) {
            const text = plaintextMap.get(ss.version_id);
            if (!text) continue;
            const prefix = String(orderIdx).padStart(2, '0');
            const statusSuffix = ss.is_approved ? 'APPROVED' : 'DRAFT';
            const seasonTag = ss.season_number ? `_s${ss.season_number}` : '';
            const fileName = `${prefix}_season_master_script${seasonTag}_${statusSuffix}.md`;
            zip.file(fileName, text);
            metaDocs.push({
              order_index: orderIdx,
              doc_type: 'season_master_script',
              label: ss.season_number ? `Master Script — Season ${ss.season_number}` : 'Master Season Script',
              doc_id: ss.document_id,
              version_id: ss.version_id,
              approved: ss.is_approved,
              file_name: fileName,
            });
            orderIdx++;
            docCount++;
          }
          continue;
        }

        const deliverable = filteredDeliverables.find(d => d.deliverable_type === docType);
        if (!deliverable) continue;

        const text = plaintextMap.get(deliverable.version_id);
        if (!text) continue;

        const prefix = String(orderIdx).padStart(2, '0');
        const statusSuffix = deliverable.is_approved ? 'APPROVED' : 'DRAFT';
        const fileName = `${prefix}_${docType}_${statusSuffix}.md`;
        zip.file(fileName, text);
        metaDocs.push({
          order_index: orderIdx,
          doc_type: docType,
          label: deliverable.label,
          doc_id: deliverable.document_id,
          version_id: deliverable.version_id,
          approved: deliverable.is_approved,
          file_name: fileName,
        });
        orderIdx++;
        docCount++;
      }

      if (docCount === 0) throw new Error('No documents available with the selected scope');

      zip.file('metadata.json', JSON.stringify({
        project_id: projectId,
        title: pkg.projectTitle,
        format,
        exported_at: new Date().toISOString(),
        scope,
        docs: metaDocs,
      }, null, 2));

      const blob = await zip.generateAsync({ type: 'blob' });
      return { blob, docCount };
    },
    onSuccess: ({ blob, docCount }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project_package_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Quick ZIP ready — ${docCount} documents`);
    },
    onError: (err: any) => {
      toast.error('Quick ZIP failed: ' + (err.message || 'Unknown error'));
    },
  });

  const isPending = serverZip.isPending || serverPdf.isPending || quickZip.isPending;
  const hasSeasonScripts = pkg.season_scripts.length > 0;

  return (
    <div className="flex items-center gap-0">
      {/* Default action: Server ZIP */}
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1.5 rounded-r-none border-r-0 h-7"
        onClick={() => serverZip.mutate()}
        disabled={isPending || pkg.totalRequired === 0}
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Download Package
      </Button>

      {/* Dropdown for options */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-xs px-1.5 rounded-l-none h-7"
            disabled={isPending}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-2 space-y-2">
          {/* Scope selector */}
          <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground pb-0">
            Content scope
          </DropdownMenuLabel>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger className="h-7 text-xs w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(SCOPE_LABELS) as [Scope, string][]).map(([val, label]) => (
                <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Toggle: master script (only shown if project has episodic format) */}
          {hasSeasonScripts && (
            <div className="flex items-center justify-between py-1">
              <Label className="text-xs text-muted-foreground">Include Master Season Script</Label>
              <Switch
                checked={includeMasterScript}
                onCheckedChange={setIncludeMasterScript}
                className="scale-75"
              />
            </div>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => serverZip.mutate()}
            disabled={isPending || pkg.totalRequired === 0}
          >
            <Server className="h-3.5 w-3.5 text-primary" />
            <div>
              <p className="font-medium">Server ZIP <span className="text-[9px] text-muted-foreground">(recommended)</span></p>
              <p className="text-[9px] text-muted-foreground">Builds on server, returns signed URL</p>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => serverPdf.mutate()}
            disabled={isPending || pkg.totalRequired === 0}
          >
            <FileText className="h-3.5 w-3.5 text-primary" />
            <div>
              <p className="font-medium">Merged PDF <span className="text-[9px] text-muted-foreground">(single file)</span></p>
              <p className="text-[9px] text-muted-foreground">All documents in one chronological PDF</p>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => quickZip.mutate()}
            disabled={isPending || pkg.totalRequired === 0}
          >
            <Monitor className="h-3.5 w-3.5 text-[hsl(var(--chart-4))]" />
            <div>
              <p className="font-medium">Quick ZIP <span className="text-[9px] text-[hsl(var(--chart-4))]">(in browser)</span></p>
              <p className="text-[9px] text-muted-foreground">May be slow for large packages</p>
            </div>
          </DropdownMenuItem>

          {quickZip.isPending && (
            <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--chart-4))] px-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>Quick ZIP may be slow for large packages. Consider Server ZIP.</span>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
