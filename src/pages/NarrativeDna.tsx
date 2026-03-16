/**
 * NarrativeDna — Phase 1 entry point for DNA extraction and review.
 * Lets users paste source text, extract DNA, review/edit/lock profiles.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, Plus, Loader2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DnaProfileCard } from '@/components/dna/DnaProfileCard';
import { useDnaProfiles, useDnaProfile, useExtractDna } from '@/hooks/useNarrativeDna';

export default function NarrativeDna() {
  const navigate = useNavigate();
  const { data: profiles = [], isLoading: listLoading } = useDnaProfiles();
  const extractMutation = useExtractDna();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('public_domain');
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'url'>('text');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: selectedProfile } = useDnaProfile(selectedId || undefined);

  function isValidHttpUrl(s: string): boolean {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  }

  const canSubmit = title.trim().length > 0 && (
    inputMode === 'text' ? sourceText.length >= 2000 : isValidHttpUrl(sourceUrl.trim())
  );

  async function handleExtract() {
    if (!canSubmit) return;
    const params: any = {
      source_title: title.trim(),
      source_type: sourceType,
    };
    if (inputMode === 'url') {
      params.source_url = sourceUrl.trim();
    } else {
      params.source_text = sourceText;
    }
    const result = await extractMutation.mutateAsync(params);
    setSelectedId(result.id);
    setShowForm(false);
    setTitle('');
    setSourceText('');
    setSourceUrl('');
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Dna className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">Narrative DNA</h1>
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => { setShowForm(true); setSelectedId(null); }}
          >
            <Plus className="h-3 w-3" />
            Extract DNA
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Extract the deep narrative engine from a source story. The resulting DNA profile captures
          structural invariants — not surface plot — that can constrain new original development seeds.
        </p>

        {/* Extraction Form */}
        {showForm && (
          <Card className="border-primary/30 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Extract from Source Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Source Title</label>
                  <Input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Beowulf"
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Source Type</label>
                  <select
                    value={sourceType}
                    onChange={e => setSourceType(e.target.value)}
                    className="w-full h-8 text-sm mt-1 rounded-md border border-input bg-background px-2"
                  >
                    <option value="public_domain">Public Domain</option>
                    <option value="user_owned">User Owned</option>
                    <option value="summary">Summary / Analysis</option>
                  </select>
                </div>
              </div>

              {/* Input mode toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Input:</span>
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                    inputMode === 'text'
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('url')}
                  className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                    inputMode === 'url'
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Use URL
                </button>
              </div>

              {inputMode === 'text' ? (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Source Text ({sourceText.length.toLocaleString()} chars — min 2,000)
                  </label>
                  <Textarea
                    value={sourceText}
                    onChange={e => setSourceText(e.target.value)}
                    placeholder="Paste the source story text here…"
                    className="mt-1 min-h-[200px] text-sm font-mono"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Source URL
                  </label>
                  <Input
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    placeholder="https://www.gutenberg.org/files/16328/16328-h/16328-h.htm"
                    className="h-8 text-sm mt-1"
                  />
                  {sourceUrl.trim() && !isValidHttpUrl(sourceUrl.trim()) && (
                    <p className="text-[10px] text-destructive mt-0.5">Must be a valid http/https URL</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Paste a public webpage containing the source text. We'll fetch the text and extract DNA from it.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={handleExtract}
                  disabled={extractMutation.isPending || !canSubmit}
                >
                  {extractMutation.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Extracting DNA…
                    </>
                  ) : (
                    <>
                      <Dna className="h-3 w-3" />
                      Extract
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main content: list + detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Profile list */}
          <div className="lg:col-span-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Your Profiles ({profiles.length})
            </h3>
            {listLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No DNA profiles yet. Extract one from a source text.
              </p>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-1.5 pr-2">
                  {profiles.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedId(p.id); setShowForm(false); }}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedId === p.id
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-accent/30 border border-transparent'
                      }`}
                    >
                      <div className="font-medium text-foreground truncate">{p.source_title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.source_type} · {p.status}
                        {p.extraction_confidence != null && ` · ${Math.round(p.extraction_confidence * 100)}%`}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Selected profile detail */}
          <div className="lg:col-span-2">
            {selectedProfile ? (
              <DnaProfileCard profile={selectedProfile} />
            ) : (
              <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground border border-dashed border-border/40 rounded-lg">
                Select a profile or extract a new one
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
