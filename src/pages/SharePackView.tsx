/**
 * SharePackView — Public read-only page for viewing a shared pack via token.
 * Route: /share/pack/:token
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Lock, Download, FileText, AlertTriangle, Briefcase, Eye } from 'lucide-react';
import { ALL_DOC_TYPE_LABELS } from '@/lib/can-promote-to-script';
import { toast } from 'sonner';

function getLabel(dt: string): string {
  return ALL_DOC_TYPE_LABELS[dt] ?? dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function SharePackView() {
  const { token } = useParams<{ token: string }>();
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Fetch link info
  const { data: linkData, isLoading, error } = useQuery({
    queryKey: ['share-pack-link', token],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_share_pack_links')
        .select('*, project_share_packs(*)')
        .eq('token', token)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!token,
  });

  const link = linkData;
  const pack = link?.project_share_packs;

  // Log view event
  useEffect(() => {
    if (link?.id && (passwordVerified || !link.password_hash)) {
      (supabase as any)
        .from('project_share_pack_events')
        .insert({ link_id: link.id, event_type: 'view', metadata: { user_agent: navigator.userAgent } })
        .then(() => {});
    }
  }, [link?.id, passwordVerified]);

  // Validation checks
  const isExpired = link?.expires_at && new Date(link.expires_at) < new Date();
  const isRevoked = link?.is_revoked;
  const isOverLimit = link?.max_downloads && link.download_count >= link.max_downloads;
  const needsPassword = link?.password_hash && !passwordVerified;
  const isAccessible = link && !isExpired && !isRevoked && !isOverLimit && !needsPassword;

  const handlePasswordSubmit = () => {
    if (!link?.password_hash) return;
    if (btoa(passwordInput) === link.password_hash) {
      setPasswordVerified(true);
    } else {
      toast.error('Incorrect password');
    }
  };

  const selection: Array<{ doc_type: string }> = pack?.selection || [];

  // Download individual file
  const handleDownloadFile = async (docType: string) => {
    if (!pack?.project_id) return;
    setDownloading(docType);
    try {
      // Fetch the approved version content
      const { data: docs } = await (supabase as any)
        .from('project_documents')
        .select('id')
        .eq('project_id', pack.project_id)
        .eq('doc_type', docType)
        .limit(1);

      if (!docs?.length) {
        toast.error('Document not found');
        return;
      }

      const { data: versions } = await (supabase as any)
        .from('project_document_versions')
        .select('plaintext')
        .eq('document_id', docs[0].id)
        .eq('status', 'final')
        .order('version_number', { ascending: false })
        .limit(1);

      const text = versions?.[0]?.plaintext;
      if (!text) {
        toast.error('No approved content available');
        return;
      }

      // Log download event
      await (supabase as any)
        .from('project_share_pack_events')
        .insert({ link_id: link.id, event_type: 'file_download', metadata: { doc_type: docType } });

      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getLabel(docType).replace(/\s+/g, '_')}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(null);
    }
  };

  // Download all as combined file
  const handleDownloadAll = async () => {
    if (!pack?.project_id) return;
    setDownloading('all');
    try {
      let combined = '';
      for (const s of selection) {
        const { data: docs } = await (supabase as any)
          .from('project_documents')
          .select('id')
          .eq('project_id', pack.project_id)
          .eq('doc_type', s.doc_type)
          .limit(1);
        if (!docs?.length) continue;

        const { data: versions } = await (supabase as any)
          .from('project_document_versions')
          .select('plaintext')
          .eq('document_id', docs[0].id)
          .eq('status', 'final')
          .order('version_number', { ascending: false })
          .limit(1);

        if (versions?.[0]?.plaintext) {
          combined += `\n\n===== ${getLabel(s.doc_type).toUpperCase()} =====\n\n`;
          combined += versions[0].plaintext;
        }
      }

      // Log download event
      await (supabase as any)
        .from('project_share_pack_events')
        .insert({ link_id: link.id, event_type: 'download', metadata: { doc_count: selection.length } });

      // Increment download count
      await (supabase as any)
        .from('project_share_pack_links')
        .update({ download_count: (link.download_count || 0) + 1 })
        .eq('id', link.id);

      const blob = new Blob([combined.trim()], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pack.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
      </div>
    );
  }

  if (error || !link) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <h2 className="text-lg font-semibold">Link Not Found</h2>
            <p className="text-sm text-muted-foreground">This share link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isExpired || isRevoked || isOverLimit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-[hsl(var(--chart-4))] mx-auto" />
            <h2 className="text-lg font-semibold">
              {isRevoked ? 'Link Revoked' : isExpired ? 'Link Expired' : 'Download Limit Reached'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isRevoked
                ? 'This share link has been revoked by the project owner.'
                : isExpired
                ? 'This share link has expired. Please request a new one from the project owner.'
                : 'This link has reached its maximum number of downloads.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="max-w-sm w-full mx-4">
          <CardHeader className="text-center">
            <Lock className="h-8 w-8 text-primary mx-auto mb-2" />
            <CardTitle className="text-base">Password Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              placeholder="Enter password"
              className="text-sm"
              onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            />
            <Button className="w-full" onClick={handlePasswordSubmit}>
              Access Pack
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Briefcase className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">{pack?.name || 'Share Pack'}</h1>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] capitalize">
              {pack?.pack_type} pack
            </Badge>
            <span>·</span>
            <span>{new Date(pack?.created_at).toLocaleDateString()}</span>
            {link.expires_at && (
              <>
                <span>·</span>
                <span>Expires {new Date(link.expires_at).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>

        {/* Document List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Included Documents ({selection.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {selection.map((s: any, i: number) => (
              <div
                key={`${s.doc_type}-${i}`}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 text-sm"
              >
                <span className="text-foreground">{getLabel(s.doc_type)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs h-7"
                  onClick={() => handleDownloadFile(s.doc_type)}
                  disabled={downloading === s.doc_type}
                >
                  <Download className="h-3 w-3" />
                  {downloading === s.doc_type ? 'Downloading…' : 'Download'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Download All */}
        <div className="mt-6 text-center">
          <Button
            size="lg"
            className="gap-2"
            onClick={handleDownloadAll}
            disabled={downloading === 'all'}
          >
            <Download className="h-4 w-4" />
            {downloading === 'all' ? 'Preparing download…' : 'Download All'}
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground mt-8">
          Shared via IFFY · {pack?.watermark_enabled ? 'Watermarked' : 'No watermark'} · Read-only access
        </p>
      </div>
    </div>
  );
}
