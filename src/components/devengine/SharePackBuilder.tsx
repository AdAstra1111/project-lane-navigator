/**
 * SharePackBuilder — Modal for creating Investor/Buyer share packs.
 * Only shows doc types with active approved versions.
 */
import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Briefcase, Building2, Settings2, Shield, Copy, Check, Loader2, Link2, Eye, Download } from 'lucide-react';
import { useProjectPackage, type PackageDeliverable, type PackageSeasonScript } from '@/hooks/useProjectPackage';
import { useSharePack, getPresetDocTypes, type PackType, type SharePackSelection } from '@/hooks/useSharePack';
import { ALL_DOC_TYPE_LABELS } from '@/lib/can-promote-to-script';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}

function getLabel(dt: string): string {
  return ALL_DOC_TYPE_LABELS[dt] ?? dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function SharePackBuilder({ open, onOpenChange, projectId }: Props) {
  const { pkg } = useProjectPackage(projectId);
  const { createPack, createLink } = useSharePack(projectId);

  const [packType, setPackType] = useState<PackType>('investor');
  const [packName, setPackName] = useState('');
  const [selectedDocTypes, setSelectedDocTypes] = useState<Set<string>>(new Set());
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkText, setWatermarkText] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [password, setPassword] = useState('');
  const [expiryDays, setExpiryDays] = useState<string>('7');
  const [includeCover, setIncludeCover] = useState(true);
  const [includeContents, setIncludeContents] = useState(true);
  const [step, setStep] = useState<'configure' | 'link'>('configure');
  const [createdPackId, setCreatedPackId] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // All approved doc types available
  const approvedDocTypes = useMemo(() => {
    if (!pkg) return [];
    const types: { doc_type: string; label: string; is_approved: boolean }[] = [];
    for (const d of pkg.deliverables) {
      types.push({ doc_type: d.deliverable_type, label: d.label, is_approved: d.is_approved });
    }
    for (const s of pkg.season_scripts) {
      types.push({
        doc_type: 'season_master_script',
        label: s.season_number ? `Master Script — S${s.season_number}` : 'Master Season Script',
        is_approved: s.is_approved,
      });
    }
    return types;
  }, [pkg]);

  // When pack type changes, update defaults
  useEffect(() => {
    const defaults = getPresetDocTypes(packType);
    const available = new Set(approvedDocTypes.filter(d => d.is_approved).map(d => d.doc_type));
    setSelectedDocTypes(new Set(defaults.filter(d => available.has(d))));
    setPackName(packType === 'investor' ? 'Investor Pack' : packType === 'buyer' ? 'Buyer Pack' : 'Custom Pack');
  }, [packType, approvedDocTypes]);

  const toggleDoc = (docType: string) => {
    setSelectedDocTypes(prev => {
      const next = new Set(prev);
      if (next.has(docType)) next.delete(docType);
      else next.add(docType);
      return next;
    });
  };

  const handleCreate = async () => {
    const selection: SharePackSelection[] = Array.from(selectedDocTypes).map(dt => ({ doc_type: dt }));
    const wText = watermarkEnabled
      ? (watermarkText || `CONFIDENTIAL${recipientName ? ` — ${recipientName}` : ''} — ${new Date().toISOString().slice(0, 10)}`)
      : undefined;

    const pack = await createPack.mutateAsync({
      name: packName,
      pack_type: packType,
      selection,
      watermark_enabled: watermarkEnabled,
      watermark_text: wText,
      include_cover: includeCover,
      include_contents: includeContents,
    });

    setCreatedPackId(pack.id);

    // Auto-create a link
    const link = await createLink.mutateAsync({
      share_pack_id: pack.id,
      password: password || undefined,
      expires_in_days: Number(expiryDays),
    });

    setGeneratedToken(link.token);
    setStep('link');
  };

  const shareUrl = generatedToken
    ? `${window.location.origin}/share/pack/${generatedToken}`
    : '';

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const el = document.createElement('textarea');
        el.value = shareUrl;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const handleClose = () => {
    setStep('configure');
    setCreatedPackId(null);
    setGeneratedToken(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            {step === 'configure' ? 'Create Share Pack' : 'Share Link Ready'}
          </DialogTitle>
        </DialogHeader>

        {step === 'configure' && (
          <div className="space-y-5">
            {/* Pack Type */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Pack Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['investor', 'buyer', 'custom'] as PackType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setPackType(t)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                      packType === t
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {t === 'investor' && <Building2 className="h-3.5 w-3.5" />}
                    {t === 'buyer' && <Briefcase className="h-3.5 w-3.5" />}
                    {t === 'custom' && <Settings2 className="h-3.5 w-3.5" />}
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Pack Name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Pack Name</Label>
              <Input
                value={packName}
                onChange={e => setPackName(e.target.value)}
                className="h-8 text-xs"
                placeholder="e.g. Investor Pack Q1 2026"
              />
            </div>

            {/* Document Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                Included Documents
                <span className="text-muted-foreground ml-1">({selectedDocTypes.size} selected)</span>
              </Label>
              <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {approvedDocTypes.map((d, i) => (
                  <label
                    key={`${d.doc_type}-${i}`}
                    className={`flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer hover:bg-muted/50 ${
                      !d.is_approved ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <Checkbox
                      checked={selectedDocTypes.has(d.doc_type)}
                      onCheckedChange={() => d.is_approved && toggleDoc(d.doc_type)}
                      disabled={!d.is_approved}
                    />
                    <span className="flex-1">{d.label}</span>
                    {d.is_approved ? (
                      <Badge variant="outline" className="text-[8px] border-[hsl(var(--chart-2)/0.4)] text-[hsl(var(--chart-2))]">
                        Approved
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[8px] text-muted-foreground">
                        No approval
                      </Badge>
                    )}
                  </label>
                ))}
                {approvedDocTypes.length === 0 && (
                  <p className="text-[10px] text-muted-foreground p-2">No documents available yet.</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Watermark */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-muted-foreground" />
                  Watermark PDFs
                </Label>
                <Switch checked={watermarkEnabled} onCheckedChange={setWatermarkEnabled} />
              </div>
              {watermarkEnabled && (
                <div className="space-y-2">
                  <Input
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Recipient name (optional)"
                  />
                  <Input
                    value={watermarkText}
                    onChange={e => setWatermarkText(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Custom watermark text (auto-generated if empty)"
                  />
                </div>
              )}
            </div>

            {/* Options */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox checked={includeCover} onCheckedChange={v => setIncludeCover(!!v)} />
                Cover sheet
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <Checkbox checked={includeContents} onCheckedChange={v => setIncludeContents(!!v)} />
                Table of contents
              </label>
            </div>

            <Separator />

            {/* Access Controls */}
            <div className="space-y-3">
              <Label className="text-xs font-medium">Access Controls</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Password (optional)</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Expires after</Label>
                  <Select value={expiryDays} onValueChange={setExpiryDays}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1" className="text-xs">1 day</SelectItem>
                      <SelectItem value="7" className="text-xs">7 days</SelectItem>
                      <SelectItem value="30" className="text-xs">30 days</SelectItem>
                      <SelectItem value="90" className="text-xs">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Create */}
            <Button
              className="w-full gap-2"
              onClick={handleCreate}
              disabled={selectedDocTypes.size === 0 || createPack.isPending || createLink.isPending}
            >
              {(createPack.isPending || createLink.isPending) ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Creating…</>
              ) : (
                <><Link2 className="h-4 w-4" />Generate Share Link</>
              )}
            </Button>
          </div>
        )}

        {step === 'link' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[hsl(var(--chart-2)/0.3)] bg-[hsl(var(--chart-2)/0.05)] p-4 text-center">
              <Check className="h-8 w-8 text-[hsl(var(--chart-2))] mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">{packName} ready</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {selectedDocTypes.size} documents · Expires in {expiryDays} days
                {password && ' · Password protected'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="text-xs h-8 font-mono truncate"
              />
              <Button size="sm" variant="outline" className="shrink-0 gap-1 h-8" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--chart-2))]" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={() => window.open(shareUrl, '_blank')}>
                <Eye className="h-3 w-3" />
                Preview
              </Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
