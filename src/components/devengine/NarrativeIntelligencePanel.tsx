/**
 * NarrativeIntelligencePanel — Read-only panel showing NDG nodes + NUE units + impacted docs.
 * Only renders when NARRATIVE_INTELLIGENCE_V0 is true.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, Network, Zap, Info } from 'lucide-react';
import { useNarrativeIntelligence } from '@/hooks/useNarrativeIntelligence';
import {
  NARRATIVE_INTELLIGENCE_V0,
  BEAT_TYPE_LABELS,
  BEAT_TYPE_COLORS,
  NODE_TYPE_LABELS,
  type NdgNode,
  type NueUnit,
} from '@/lib/narrativeIntelligence';

interface Props {
  projectId: string | undefined;
  versionId: string | undefined;
  currentDocType?: string;
  ladder?: string[];
}

export function NarrativeIntelligencePanel({ projectId, versionId, currentDocType, ladder }: Props) {
  const { ndgNodes, nuePayload, isEnabled } = useNarrativeIntelligence(projectId, versionId);

  if (!isEnabled) return null;

  const canonNodes = ndgNodes.filter((n) => n.status === 'canon');
  const candidateNodes = ndgNodes.filter((n) => n.status === 'candidate');
  const units = nuePayload?.units || [];

  // Compute impacted docs (simple client-side version)
  const impactedDocs: string[] = [];
  if (currentDocType && ladder && ladder.length > 0) {
    const currentIdx = ladder.indexOf(currentDocType);
    const seen = new Set<string>();
    for (const node of ndgNodes) {
      for (const t of node.impact_targets) {
        if (t.doc_type === currentDocType || seen.has(t.doc_type)) continue;
        const idx = ladder.indexOf(t.doc_type);
        if (idx < 0) continue;
        if (t.scope === 'upstream' && idx < currentIdx) seen.add(t.doc_type);
        else if (t.scope === 'downstream' && idx > currentIdx) seen.add(t.doc_type);
        else if (t.scope === 'both') seen.add(t.doc_type);
      }
    }
    impactedDocs.push(...Array.from(seen).sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b)));
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="py-2 px-4">
        <CardTitle className="text-xs flex items-center gap-2">
          <Brain className="h-3.5 w-3.5" /> Narrative Intelligence
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-auto">v0</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {/* NDG Nodes */}
        <div>
          <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Network className="h-3 w-3" /> Decision Graph
            <span className="ml-auto">{canonNodes.length} canon · {candidateNodes.length} candidates</span>
          </div>
          {ndgNodes.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No NDG nodes yet</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {ndgNodes.slice(0, 10).map((node) => (
                <div key={node.node_id} className="flex items-start gap-1.5 text-[10px]">
                  <Badge
                    variant={node.status === 'canon' ? 'default' : 'secondary'}
                    className="text-[8px] px-1 py-0 shrink-0"
                  >
                    {NODE_TYPE_LABELS[node.node_type] || node.node_type}
                  </Badge>
                  <span className="truncate">{node.summary}</span>
                  {node.confidence != null && (
                    <span className="text-muted-foreground shrink-0">{Math.round(node.confidence * 100)}%</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* NUE Units */}
        <div>
          <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Zap className="h-3 w-3" /> Narrative Units
            <span className="ml-auto">{units.length} units</span>
          </div>
          {units.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No units extracted for this version</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {units.slice(0, 12).map((unit) => (
                <div key={unit.unit_id} className="flex items-start gap-1.5 text-[10px]">
                  <Badge className={`text-[8px] px-1 py-0 shrink-0 ${BEAT_TYPE_COLORS[unit.beat_type] || ''}`}>
                    {BEAT_TYPE_LABELS[unit.beat_type] || unit.beat_type}
                  </Badge>
                  <span className="truncate">{unit.short}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Impacted Docs */}
        {impactedDocs.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
              <Info className="h-3 w-3" /> Impacted Documents
            </div>
            <div className="flex flex-wrap gap-1">
              {impactedDocs.map((doc) => (
                <Badge key={doc} variant="outline" className="text-[8px] px-1.5 py-0">
                  {doc.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
