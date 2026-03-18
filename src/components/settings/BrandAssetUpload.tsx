import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Upload, Trash2, Loader2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export function BrandAssetUpload() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Fetch current logo
  const { data: asset, isLoading } = useQuery({
    queryKey: ['brand-asset-logo', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await (supabase as any)
        .from('brand_assets')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_type', 'logo')
        .eq('label', 'primary')
        .maybeSingle();
      if (!data) return null;
      // Get signed URL for preview
      const { data: signed } = await supabase.storage
        .from('brand-assets')
        .createSignedUrl(data.storage_path, 3600);
      return { ...data, signedUrl: signed?.signedUrl || null };
    },
    enabled: !!user,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error('Not authenticated');
      if (!ACCEPTED.includes(file.type)) throw new Error('Only PNG, JPEG, or WebP files are accepted');
      if (file.size > MAX_SIZE) throw new Error('File must be under 5MB');

      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/logo/primary.${ext}`;

      // Upload (upsert)
      const { error: upErr } = await supabase.storage
        .from('brand-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Get image dimensions
      const dims = await getImageDimensions(file);

      // Upsert DB record
      const { error: dbErr } = await (supabase as any)
        .from('brand_assets')
        .upsert({
          user_id: user.id,
          asset_type: 'logo',
          label: 'primary',
          storage_path: path,
          mime_type: file.type,
          width: dims.width,
          height: dims.height,
        }, { onConflict: 'user_id,asset_type,label' });
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brand-asset-logo'] });
      toast.success('Logo uploaded successfully');
      setPreview(null);
    },
    onError: (err: Error) => {
      toast.error(`Upload failed: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!user || !asset) throw new Error('No asset to delete');
      await supabase.storage.from('brand-assets').remove([asset.storage_path]);
      const { error } = await (supabase as any)
        .from('brand_assets')
        .delete()
        .eq('id', asset.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brand-asset-logo'] });
      toast.success('Logo removed');
      setPreview(null);
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Preview
    const url = URL.createObjectURL(file);
    setPreview(url);
    uploadMutation.mutate(file);
    e.target.value = '';
  };

  const displayUrl = preview || asset?.signedUrl;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        {/* Logo preview */}
        <div className="w-20 h-20 rounded-lg border border-border/50 bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : displayUrl ? (
            <img src={displayUrl} alt="Paradox House logo" className="max-w-full max-h-full object-contain" />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          )}
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm text-foreground font-medium">Paradox House Logo</p>
          <p className="text-xs text-muted-foreground">
            Used on PDF export cover pages and headers. PNG with transparent background recommended.
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              {asset ? 'Replace' : 'Upload'}
            </Button>
            {asset && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = URL.createObjectURL(file);
  });
}
