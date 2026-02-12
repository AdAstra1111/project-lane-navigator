import { useState } from 'react';
import { BookOpen, Search, ChevronDown, ChevronUp, Loader2, Film, Users, BarChart3, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useCorpusScripts, useCorpusArtifacts, useCorpusSearch } from '@/hooks/useCorpus';

export function CorpusLibrary() {
  const { data: scripts = [], isLoading } = useCorpusScripts();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const corpusSearch = useCorpusSearch();

  const handleSearch = () => {
    if (searchQuery.trim()) corpusSearch.mutate(searchQuery.trim());
  };

  const completedScripts = scripts.filter(s => s.ingestion_status === 'complete');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Great Scripts Library</h3>
        <Badge variant="secondary">{completedScripts.length}</Badge>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search corpus (e.g. 'interrogation scene tension')…"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={corpusSearch.isPending} size="sm">
          {corpusSearch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {/* Search results */}
      {corpusSearch.data && (
        <div className="space-y-2 p-3 rounded-md border border-border bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground">{corpusSearch.data.chunks?.length || 0} matches</p>
          {(corpusSearch.data.chunks || []).slice(0, 5).map((chunk: any, i: number) => {
            const script = (corpusSearch.data.scripts || []).find((s: any) => s.id === chunk.script_id);
            return (
              <div key={i} className="p-2 rounded bg-background border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">{script?.approved_sources?.title || 'Unknown'}</Badge>
                  <span className="text-xs text-muted-foreground">Chunk #{chunk.chunk_index}</span>
                </div>
                <p className="text-xs text-foreground line-clamp-3">{chunk.chunk_text?.slice(0, 300)}…</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Script list */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : completedScripts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No scripts ingested yet. Add and ingest approved sources to populate the library.</p>
      ) : (
        <div className="space-y-2">
          {completedScripts.map(script => (
            <CorpusScriptCard
              key={script.id}
              script={script}
              isExpanded={expandedId === script.id}
              onToggle={() => setExpandedId(expandedId === script.id ? null : script.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CorpusScriptCard({ script, isExpanded, onToggle }: { script: any; isExpanded: boolean; onToggle: () => void }) {
  const { data: artifacts = [] } = useCorpusArtifacts(isExpanded ? script.id : null);

  const beats = artifacts.find(a => a.artifact_type === 'beats')?.json_data || [];
  const arcs = artifacts.find(a => a.artifact_type === 'character_arcs')?.json_data || [];
  const budgetFlags = artifacts.find(a => a.artifact_type === 'budget_flags')?.json_data || [];
  const pacingMap = artifacts.find(a => a.artifact_type === 'pacing_map')?.json_data;

  const title = script.approved_sources?.title || 'Untitled Script';

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 rounded-md border border-border bg-card cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-3">
            <Film className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">{title}</span>
            <Badge variant="outline" className="text-xs">~{script.page_count_estimate} pp</Badge>
          </div>
          <div className="flex items-center gap-2">
            {beats.length > 0 && <Badge variant="secondary" className="text-xs">{beats.length} beats</Badge>}
            {arcs.length > 0 && <Badge variant="secondary" className="text-xs">{arcs.length} arcs</Badge>}
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-4 border border-t-0 border-border rounded-b-md space-y-4 bg-card">
          {/* Beats */}
          {beats.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-2"><BarChart3 className="w-3 h-3" /> Beat Structure</h4>
              <div className="space-y-1">
                {(Array.isArray(beats) ? beats : []).map((b: any, i: number) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground w-6">{b.beat_number || i + 1}.</span>
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground">— {b.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Character arcs */}
          {arcs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-2"><Users className="w-3 h-3" /> Character Arcs</h4>
              <div className="space-y-1">
                {(Array.isArray(arcs) ? arcs : []).map((a: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground"> ({a.arc_type}) — {a.arc_summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Budget flags */}
          {budgetFlags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1 mb-2"><DollarSign className="w-3 h-3" /> Budget Drivers</h4>
              <div className="flex flex-wrap gap-1">
                {(Array.isArray(budgetFlags) ? budgetFlags : []).map((f: any, i: number) => (
                  <Badge key={i} variant={f.severity === 'high' ? 'destructive' : 'outline'} className="text-xs">
                    {f.flag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Pacing */}
          {pacingMap?.act_breaks && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">Act Breaks</h4>
              <p className="text-xs text-muted-foreground">Pages: {(pacingMap.act_breaks || []).join(', ')}</p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
