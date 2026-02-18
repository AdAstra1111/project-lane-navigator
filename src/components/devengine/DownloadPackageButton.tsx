/**
 * DownloadPackageButton — split button with Server ZIP (recommended) and Quick ZIP (browser) options.
 * Includes scope selector and master script toggle.
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
  Download, ChevronDown, Server, Monitor, Loader2, AlertTriangle,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { getLadderForFormat } from '@/lib/stages/registry';
import { ALL_DOC_TYPE_LABELS } from '@/lib/can-promote-to-script';

type Scope = 'approved_preferred' | 'approved_only' | 'latest_only';

interface Props {
  projectId: string;
  format: string;
}

const SCOPE_LABELS: Record<Scope, string> = {
  approved_preferred: 'Approved preferred (default)',
  approved_only: 'Approved only',
  latest_only: 'Latest only',
};

function getLabel(docType: string): string {
  return ALL_DOC_TYPE_LABELS[docType] ?? docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function DownloadPackageButton({ projectId, format }: Props) {
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
          expiresInSeconds: 3600, // 1h for direct download
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { signed_url: string; doc_count: number };
    },
    onSuccess: (data) => {
      // Trigger browser download via signed URL
      const a = document.createElement('a');
      a.href = data.signed_url;
      a.download = 'package.zip';
      a.click();
      toast.success(`Package ready — ${data.doc_count} documents`);
    },
    onError: (err: any) => {
      toast.error('Server export failed: ' + (err.message || 'Unknown error'));
    },
  });

  // ── QUICK ZIP (client-side) ──
  const quickZip = useMutation({
    mutationFn: async () => {
      const ladder = getLadderForFormat(format).filter(dt =>
        includeMasterScript || dt !== 'season_master_script'
      );

      // Fetch docs
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id, doc_type, latest_version_id')
        .eq('project_id', projectId);

      const docMap = new Map<string, any>((docs || []).map((d: any) => [d.doc_type, d]));

      // Fetch latest versions
      const latestIds = (docs || [])
        .filter((d: any) => d.latest_version_id)
        .map((d: any) => d.latest_version_id as string);
      let versionMap = new Map<string, any>();
      if (latestIds.length > 0) {
        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('id, status, plaintext, document_id')
          .in('id', latestIds);
        versionMap = new Map((versions || []).map((v: any) => [v.id, v]));
      }

      // Fetch approved versions if needed
      const docIds = (docs || []).map((d: any) => d.id as string);
      type ApprovedEntry = { id: string; plaintext: string; status: string };
      let approvedMap = new Map<string, ApprovedEntry>();
      if (scope !== 'latest_only' && docIds.length > 0) {
        const { data: finalVers } = await (supabase as any)
          .from('project_document_versions')
          .select('id, document_id, plaintext, status')
          .in('document_id', docIds)
          .eq('status', 'final')
          .order('version_number', { ascending: false });
        for (const v of (finalVers || [])) {
          if (!approvedMap.has(v.document_id)) approvedMap.set(v.document_id, v);
        }
      }

      const zip = new JSZip();
      const metaDocs: any[] = [];
      let docCount = 0;

      for (let i = 0; i < ladder.length; i++) {
        const docType = ladder[i];
        const doc = docMap.get(docType);
        if (!doc) continue;
        const orderPrefix = String(i + 1).padStart(2, '0');

        let plaintext: string | null = null;
        let approved = false;

        if (scope === 'approved_preferred' || scope === 'approved_only') {
          const apv = approvedMap.get(doc.id);
          if (apv) { plaintext = apv.plaintext; approved = true; }
          else if (scope === 'approved_only') continue;
          else {
            const lv = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
            if (lv) { plaintext = lv.plaintext; approved = false; }
          }
        } else {
          const lv = doc.latest_version_id ? versionMap.get(doc.latest_version_id) : null;
          if (lv) { plaintext = lv.plaintext; approved = lv.status === 'final'; }
        }

        if (!plaintext) continue;

        const statusSuffix = approved ? 'APPROVED' : 'DRAFT';
        const fileName = `${orderPrefix}_${docType}_${statusSuffix}.md`;
        zip.file(fileName, plaintext);
        metaDocs.push({ order_index: i + 1, doc_type: docType, label: getLabel(docType), doc_id: doc.id, approved, file_name: fileName });
        docCount++;
      }

      if (docCount === 0) throw new Error('No documents available with the selected scope');

      zip.file('metadata.json', JSON.stringify({
        project_id: projectId,
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
      a.download = `package_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Quick ZIP ready — ${docCount} documents`);
    },
    onError: (err: any) => {
      toast.error('Quick ZIP failed: ' + (err.message || 'Unknown error'));
    },
  });

  const isPending = serverZip.isPending || quickZip.isPending;

  return (
    <div className="flex items-center gap-0">
      {/* Default action: Server ZIP */}
      <Button
        variant="outline"
        size="sm"
        className="text-xs gap-1.5 rounded-r-none border-r-0 h-7"
        onClick={() => serverZip.mutate()}
        disabled={isPending}
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
          <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground pb-0">Scope</DropdownMenuLabel>
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

          {/* Toggle: master script */}
          <div className="flex items-center justify-between py-1">
            <Label className="text-xs text-muted-foreground">Include Master Season Script</Label>
            <Switch
              checked={includeMasterScript}
              onCheckedChange={setIncludeMasterScript}
              className="scale-75"
            />
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => serverZip.mutate()}
            disabled={isPending}
          >
            <Server className="h-3.5 w-3.5 text-primary" />
            <div>
              <p className="font-medium">Server ZIP <span className="text-[9px] text-muted-foreground">(recommended)</span></p>
              <p className="text-[9px] text-muted-foreground">Builds on server, returns signed URL</p>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2 text-xs cursor-pointer"
            onClick={() => quickZip.mutate()}
            disabled={isPending}
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
