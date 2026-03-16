/**
 * DnaSourceMaterial — Reusable Source Material section for DNA profiles.
 * Displays, adds, edits, and removes source links for any DNA record.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ExternalLink, Plus, Pencil, Trash2, Star, StarOff, Loader2, X, Check } from 'lucide-react';
import {
  useDnaSourceLinks,
  useAddDnaSourceLink,
  useUpdateDnaSourceLink,
  useRemoveDnaSourceLink,
  type DnaSourceLink,
} from '@/hooks/useNarrativeDna';

const SOURCE_TYPE_OPTIONS = [
  { value: 'public_domain_text', label: 'Public Domain Text' },
  { value: 'publisher_page', label: 'Publisher Page' },
  { value: 'archive', label: 'Archive' },
  { value: 'reference', label: 'Reference' },
  { value: 'other', label: 'Other' },
];

const SOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_TYPE_OPTIONS.map(o => [o.value, o.label])
);

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface Props {
  dnaProfileId: string;
  isLocked?: boolean;
}

interface FormState {
  source_label: string;
  source_url: string;
  source_type: string;
  is_primary: boolean;
  notes: string;
}

const EMPTY_FORM: FormState = {
  source_label: '',
  source_url: '',
  source_type: 'other',
  is_primary: false,
  notes: '',
};

export function DnaSourceMaterial({ dnaProfileId, isLocked = false }: Props) {
  const { data: links = [], isLoading } = useDnaSourceLinks(dnaProfileId);
  const addMutation = useAddDnaSourceLink();
  const updateMutation = useUpdateDnaSourceLink();
  const removeMutation = useRemoveDnaSourceLink();

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function openAdd() {
    setForm({ ...EMPTY_FORM, is_primary: links.length === 0 });
    setShowAdd(true);
    setEditingId(null);
  }

  function openEdit(link: DnaSourceLink) {
    setForm({
      source_label: link.source_label,
      source_url: link.source_url,
      source_type: link.source_type,
      is_primary: link.is_primary,
      notes: link.notes || '',
    });
    setEditingId(link.id);
    setShowAdd(false);
  }

  function cancel() {
    setShowAdd(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const formValid = form.source_label.trim().length > 0 && isValidUrl(form.source_url.trim());

  async function handleAdd() {
    if (!formValid) return;
    await addMutation.mutateAsync({
      dna_profile_id: dnaProfileId,
      source_label: form.source_label.trim(),
      source_url: form.source_url.trim(),
      source_type: form.source_type,
      is_primary: form.is_primary,
      notes: form.notes.trim(),
    });
    cancel();
  }

  async function handleUpdate() {
    if (!editingId || !formValid) return;
    await updateMutation.mutateAsync({
      id: editingId,
      dna_profile_id: dnaProfileId,
      updates: {
        source_label: form.source_label.trim(),
        source_url: form.source_url.trim(),
        source_type: form.source_type,
        is_primary: form.is_primary,
        notes: form.notes.trim(),
      },
    });
    cancel();
  }

  async function handleRemove(id: string) {
    await removeMutation.mutateAsync({ id, dna_profile_id: dnaProfileId });
  }

  async function togglePrimary(link: DnaSourceLink) {
    await updateMutation.mutateAsync({
      id: link.id,
      dna_profile_id: dnaProfileId,
      updates: { is_primary: !link.is_primary },
    });
  }

  const formFields = (
    <div className="space-y-2 p-2 border border-border/40 rounded-md bg-background/50">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-[11px] text-muted-foreground">Label</span>
          <Input
            value={form.source_label}
            onChange={e => setForm(f => ({ ...f, source_label: e.target.value }))}
            placeholder="e.g. Beowulf — Full Text"
            className="h-7 text-xs mt-0.5"
          />
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground">Type</span>
          <select
            value={form.source_type}
            onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}
            className="w-full h-7 text-xs mt-0.5 rounded-md border border-input bg-background px-2"
          >
            {SOURCE_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <span className="text-[11px] text-muted-foreground">URL</span>
        <Input
          value={form.source_url}
          onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))}
          placeholder="https://..."
          className="h-7 text-xs mt-0.5"
        />
        {form.source_url.trim() && !isValidUrl(form.source_url.trim()) && (
          <p className="text-[10px] text-destructive mt-0.5">Must be a valid http/https URL</p>
        )}
      </div>
      <div>
        <span className="text-[11px] text-muted-foreground">Notes (optional)</span>
        <Textarea
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className="text-xs mt-0.5 min-h-[40px]"
          placeholder="Optional notes about this source…"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_primary}
            onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))}
            className="rounded border-input"
          />
          Primary source
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!formValid || addMutation.isPending || updateMutation.isPending}
          onClick={editingId ? handleUpdate : handleAdd}
        >
          {(addMutation.isPending || updateMutation.isPending) ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {editingId ? 'Update' : 'Add'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={cancel}>
          <X className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Source Material
        </h4>
        {!isLocked && !showAdd && !editingId && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 px-1.5" onClick={openAdd}>
            <Plus className="h-3 w-3" /> Add source
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : links.length === 0 && !showAdd ? (
        <p className="text-xs text-muted-foreground py-1">No source links yet.</p>
      ) : (
        <div className="space-y-1.5">
          {links.map(link => (
            editingId === link.id ? (
              <div key={link.id}>{formFields}</div>
            ) : (
              <div
                key={link.id}
                className="flex items-start gap-2 p-1.5 rounded-md border border-border/30 bg-muted/20 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {link.is_primary && (
                      <Badge variant="default" className="text-[9px] px-1 py-0 shrink-0">
                        Primary
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                      {SOURCE_TYPE_LABELS[link.source_type] || link.source_type}
                    </Badge>
                    <span className="text-xs font-medium text-foreground truncate">
                      {link.source_label}
                    </span>
                  </div>
                  <a
                    href={link.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary hover:underline truncate block mt-0.5"
                  >
                    {link.source_url}
                  </a>
                  {link.notes && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{link.notes}</p>
                  )}
                </div>
                {!isLocked && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      title={link.is_primary ? 'Remove primary' : 'Set as primary'}
                      onClick={() => togglePrimary(link)}
                    >
                      {link.is_primary
                        ? <StarOff className="h-3 w-3 text-amber-500" />
                        : <Star className="h-3 w-3 text-muted-foreground" />
                      }
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => openEdit(link)}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemove(link.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}
                <a
                  href={link.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 p-1"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                </a>
              </div>
            )
          ))}
        </div>
      )}

      {showAdd && formFields}
    </div>
  );
}