/**
 * CharacterVisualDNAPanel — Displays the full Visual DNA model for a character.
 * Shows all layers: Script Truth, Binding Markers, Narrative Markers, Invariants,
 * Flexible Axes, Producer Guidance (classified), Contradictions, Missing Clarifications,
 * and AI-extracted Evidence Traits with provenance.
 */
import { useState, useEffect } from 'react';
import {
  Shield, Lock, AlertTriangle, Eye, ChevronDown,
  Loader2, RefreshCw, Dna, CheckCircle, XCircle, HelpCircle, Layers,
  Sparkles, Search, Info, Target, Check, X, Edit3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useVisualDNA } from '@/hooks/useVisualDNA';
import {
  resolveCharacterVisualDNA,
  deserializeBindingMarkers,
  deserializeEvidenceTraits,
  deserializeTransientStates,
  type CharacterVisualDNA,
  type VisualDNATrait,
  type EvidenceTrait,
  type TransientVisualState,
  type ProducerGuidanceItem,
  type ClarificationStatus,
} from '@/lib/images/visualDNA';
import { resolveCharacterIdentity } from '@/lib/images/identityResolver';
import type { TraitCategory, TraitSource, BindingMarker, MarkerStatus } from '@/lib/images/characterTraits';
import {
  executeDnaAutoFlow,
  type DnaAutoFlowMode,
  type DnaAutoFlowResult,
  DNA_AUTO_FLOW_MODE_DEFAULT,
} from '@/lib/images/dnaAutoFlow';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  projectId: string;
  characterName: string;
  canonCharacter: Record<string, unknown> | null;
  canonJson: Record<string, unknown> | null;
  userNotes: string;
}

const SOURCE_COLORS: Record<TraitSource, string> = {
  script: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  narrative: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
  inferred: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30',
  user: 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30',
  evidence: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
};

const CATEGORY_LABELS: Record<TraitCategory, string> = {
  age: 'Age',
  gender: 'Gender',
  build: 'Build',
  face: 'Face',
  hair: 'Hair',
  skin: 'Skin',
  clothing: 'Clothing',
  posture: 'Posture',
  marker: 'Marker',
  other: 'Other',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-muted-foreground',
};

const MARKER_STATUS_COLORS: Record<MarkerStatus, string> = {
  detected: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30',
  pending_resolution: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  rejected: 'bg-destructive/20 text-destructive border-destructive/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

const CLARIFICATION_STATUS_COLORS: Record<ClarificationStatus, string> = {
  resolved: 'text-emerald-600 dark:text-emerald-400',
  partial: 'text-amber-600 dark:text-amber-400',
  missing: 'text-destructive',
};

function TraitBadge({ trait }: { trait: VisualDNATrait }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border',
      SOURCE_COLORS[trait.source],
    )}>
      {trait.constraint === 'locked' && <Lock className="h-2.5 w-2.5" />}
      {trait.label}
    </span>
  );
}

function EvidenceTraitBadge({ trait }: { trait: EvidenceTrait }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-help',
            SOURCE_COLORS.evidence,
          )}>
            <Search className="h-2.5 w-2.5" />
            {trait.label}
            <span className={cn('text-[8px]', CONFIDENCE_COLORS[trait.confidence])}>
              {trait.confidence === 'high' ? '●' : trait.confidence === 'medium' ? '◐' : '○'}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold">Source: {trait.evidenceSource}</p>
            {trait.evidenceExcerpt && (
              <p className="text-[9px] text-muted-foreground italic">"{trait.evidenceExcerpt}"</p>
            )}
            <p className="text-[9px]">Confidence: <span className={CONFIDENCE_COLORS[trait.confidence]}>{trait.confidence}</span></p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BindingMarkerCard({
  marker,
  onApprove,
  onReject,
  onUpdateLaterality,
}: {
  marker: BindingMarker;
  onApprove: () => void;
  onReject: () => void;
  onUpdateLaterality: (lat: BindingMarker['laterality']) => void;
}) {
  return (
    <div className={cn(
      'flex items-start gap-2 px-2 py-1.5 rounded-md border text-[10px]',
      MARKER_STATUS_COLORS[marker.status],
    )}>
      <Target className="h-3 w-3 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold uppercase">{marker.markerType}</span>
          {marker.bodyRegion !== 'unspecified' && (
            <span className="opacity-80">on {marker.bodyRegion}</span>
          )}
          {marker.laterality !== 'unknown' && (
            <Badge variant="outline" className="text-[8px] h-3.5 px-1">{marker.laterality}</Badge>
          )}
          <Badge variant="outline" className="text-[8px] h-3.5 px-1">{marker.status}</Badge>
        </div>
        
        {marker.evidenceExcerpt && (
          <p className="text-[9px] opacity-70 italic mt-0.5 truncate">"{marker.evidenceExcerpt}"</p>
        )}
        
        {/* Resolution controls for unresolved fields */}
        {marker.requiresUserDecision && marker.unresolvedFields.includes('laterality') && marker.status !== 'rejected' && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[9px] font-medium">Side:</span>
            <Select
              value={marker.laterality}
              onValueChange={(v) => onUpdateLaterality(v as BindingMarker['laterality'])}
            >
              <SelectTrigger className="h-5 text-[9px] w-20 px-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left" className="text-[10px]">Left</SelectItem>
                <SelectItem value="right" className="text-[10px]">Right</SelectItem>
                <SelectItem value="center" className="text-[10px]">Center</SelectItem>
                <SelectItem value="bilateral" className="text-[10px]">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      
      {/* Action buttons */}
      {marker.status !== 'approved' && marker.status !== 'rejected' && (
        <div className="flex gap-0.5 flex-shrink-0">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onApprove}>
            <Check className="h-3 w-3 text-emerald-600" />
          </Button>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onReject}>
            <X className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      )}
      {marker.status === 'approved' && (
        <Lock className="h-3 w-3 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
      )}
    </div>
  );
}

function DNASection({
  title,
  icon,
  traits,
  description,
  color,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  traits: VisualDNATrait[];
  description: string;
  color: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  
  if (traits.length === 0) return null;
  
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between w-full py-1.5">
          <div className="flex items-center gap-2">
            <span className={cn('flex-shrink-0', color)}>{icon}</span>
            <span className="text-[11px] font-semibold text-foreground">{title}</span>
            <Badge variant="secondary" className="text-[9px] h-4 px-1">{traits.length}</Badge>
          </div>
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-[9px] text-muted-foreground mb-1.5">{description}</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {traits.map((t, i) => <TraitBadge key={`${t.label}-${i}`} trait={t} />)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CharacterVisualDNAPanel({ projectId, characterName, canonCharacter, canonJson, userNotes }: Props) {
  const { currentDNA, isLoading, resolveDNA } = useVisualDNA(projectId, characterName);
  const [localDNA, setLocalDNA] = useState<CharacterVisualDNA | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [evidenceTraits, setEvidenceTraits] = useState<EvidenceTrait[]>([]);
  const [evidenceSources, setEvidenceSources] = useState<string[]>([]);
  const [bindingMarkers, setBindingMarkers] = useState<BindingMarker[]>([]);
  const [autoFlowMode, setAutoFlowMode] = useState<DnaAutoFlowMode>(DNA_AUTO_FLOW_MODE_DEFAULT);
  const [autoFlowResult, setAutoFlowResult] = useState<DnaAutoFlowResult | null>(null);
  
  // Auto-resolve DNA on mount via canonical auto-flow (localOnly for speed)
  useEffect(() => {
    async function resolve() {
      try {
        const result = await executeDnaAutoFlow({
          projectId,
          characterName,
          canonCharacter,
          canonJson,
          userNotes,
          config: { mode: autoFlowMode },
          localOnly: true, // Don't call edge function on mount
          existingMarkers: bindingMarkers.length > 0 ? bindingMarkers : undefined,
          existingEvidence: evidenceTraits.length > 0 ? evidenceTraits : undefined,
        });
        
        setLocalDNA(result.dna);
        setAutoFlowResult(result);
        
        // Sync markers/evidence from persisted state if not locally set
        if (result.dna.bindingMarkers.length > 0 && bindingMarkers.length === 0) {
          setBindingMarkers(result.dna.bindingMarkers);
        }
        if (result.dna.evidenceTraits.length > 0 && evidenceTraits.length === 0) {
          setEvidenceTraits(result.dna.evidenceTraits);
        }
      } catch {
        // Silently fail — DNA panel will show loading state
      }
    }
    resolve();
  }, [projectId, characterName, canonCharacter, canonJson, userNotes, currentDNA, autoFlowMode]);

  // Re-resolve when markers change (local-only, fast)
  useEffect(() => {
    if (!localDNA) return;
    const resolveWithMarkers = async () => {
      const result = await executeDnaAutoFlow({
        projectId,
        characterName,
        canonCharacter,
        canonJson,
        userNotes,
        config: { mode: autoFlowMode },
        localOnly: true,
        existingMarkers: bindingMarkers,
        existingEvidence: evidenceTraits,
      });
      setLocalDNA(result.dna);
      setAutoFlowResult(result);
    };
    resolveWithMarkers();
  }, [bindingMarkers, evidenceTraits]);

  // Auto-fill from project evidence via canonical auto-flow (full extraction)
  const handleAutoFill = async () => {
    setExtracting(true);
    try {
      const result = await executeDnaAutoFlow({
        projectId,
        characterName,
        canonCharacter,
        canonJson,
        userNotes,
        config: { mode: autoFlowMode },
        localOnly: false, // Call edge function for full extraction
        existingMarkers: bindingMarkers,
        existingEvidence: [], // Force fresh extraction
      });
      
      setLocalDNA(result.dna);
      setAutoFlowResult(result);
      setEvidenceTraits(result.dna.evidenceTraits);
      setBindingMarkers(result.dna.bindingMarkers);
      
      const totalCount = result.dna.evidenceTraits.length + result.dna.bindingMarkers.length;
      if (result.persisted) {
        toast.success(`Extracted ${totalCount} traits — auto-saved DNA v${result.persistedVersionNumber} (Mode ${autoFlowMode === 'aggressive' ? 'B' : 'A'})`);
      } else if (totalCount > 0) {
        toast.success(`Extracted ${totalCount} traits (not yet saved — ${result.integrity.status})`);
      } else {
        toast.info('No visual traits found in project evidence for this character');
      }
    } catch (e: any) {
      toast.error(`Evidence extraction failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  };

  // Marker actions
  const handleApproveMarker = (markerId: string) => {
    setBindingMarkers(prev => prev.map(m =>
      m.id === markerId
        ? { ...m, status: 'approved' as MarkerStatus, approvedAt: new Date().toISOString(), requiresUserDecision: false }
        : m
    ));
    toast.success('Marker approved — will be enforced in future images');
  };

  const handleRejectMarker = (markerId: string) => {
    setBindingMarkers(prev => prev.map(m =>
      m.id === markerId ? { ...m, status: 'rejected' as MarkerStatus } : m
    ));
  };

  const handleUpdateLaterality = (markerId: string, laterality: BindingMarker['laterality']) => {
    setBindingMarkers(prev => prev.map(m => {
      if (m.id !== markerId) return m;
      const newUnresolved = m.unresolvedFields.filter(f => f !== 'laterality');
      return {
        ...m,
        laterality,
        unresolvedFields: newUnresolved,
        requiresUserDecision: newUnresolved.length > 0,
        status: newUnresolved.length === 0 && m.status === 'pending_resolution' ? 'detected' as MarkerStatus : m.status,
      };
    }));
  };
  
  const dna = localDNA;
  
  if (!dna) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-[10px]">Resolving Visual DNA...</span>
      </div>
    );
  }
  
  const hasContradictions = dna.contradictions.length > 0;
  const hasMissing = dna.missingClarifications.length > 0;
  const hasEvidence = evidenceTraits.length > 0 || dna.evidenceTraits.length > 0;
  const hasTransient = dna.transientStates.length > 0;
  const displayEvidence = evidenceTraits.length > 0 ? evidenceTraits : dna.evidenceTraits;
  const activeMarkers = bindingMarkers.filter(m => m.status !== 'rejected' && m.status !== 'archived');
  const approvedMarkers = bindingMarkers.filter(m => m.status === 'approved');
  const pendingMarkers = bindingMarkers.filter(m => m.status === 'detected' || m.status === 'pending_resolution');
  
  return (
    <Card className="border-border/60 bg-muted/10">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Dna className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-foreground">CHARACTER VISUAL DNA</span>
            <Badge variant={dna.identityStrength === 'strong' ? 'default' : 'secondary'} className="text-[9px] h-4">
              {dna.identityStrength === 'strong' ? '🔒 Strong' : dna.identityStrength === 'partial' ? '⚠ Partial' : '○ Weak'}
            </Badge>
            <Badge variant="outline" className="text-[8px] h-3.5 px-1">
              Mode {autoFlowMode === 'aggressive' ? 'B' : 'A'}
            </Badge>
            {autoFlowResult?.persisted && (
              <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-primary/30 text-primary/80">
                Auto-saved v{autoFlowResult.persistedVersionNumber}
              </Badge>
            )}
            {autoFlowResult && !autoFlowResult.persisted && (
              <Badge variant="outline" className="text-[8px] h-3.5 px-1 text-muted-foreground">
                {autoFlowResult.integrity.status.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={handleAutoFill}
              disabled={extracting}
            >
              {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Auto-fill
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={() => resolveDNA.mutate({ canonCharacter, canonJson, userNotes })}
              disabled={resolveDNA.isPending}
            >
              {resolveDNA.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Save DNA
            </Button>
          </div>
        </div>

        {/* Binding Markers Section */}
        {activeMarkers.length > 0 && (
          <div className="border border-rose-500/30 rounded-md p-2 bg-rose-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="h-3 w-3 text-rose-600 dark:text-rose-400" />
              <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                Binding Visual Markers
              </span>
              {approvedMarkers.length > 0 && (
                <Badge variant="default" className="text-[8px] h-3.5 px-1 bg-emerald-600">{approvedMarkers.length} enforced</Badge>
              )}
              {pendingMarkers.length > 0 && (
                <Badge variant="secondary" className="text-[8px] h-3.5 px-1">{pendingMarkers.length} pending</Badge>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mb-1.5">
              Approved markers are enforced in all generated images when the body region is visible.
            </p>
            <div className="space-y-1">
              {activeMarkers.map(m => (
                <BindingMarkerCard
                  key={m.id}
                  marker={m}
                  onApprove={() => handleApproveMarker(m.id)}
                  onReject={() => handleRejectMarker(m.id)}
                  onUpdateLaterality={(lat) => handleUpdateLaterality(m.id, lat)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Evidence Traits — AI-extracted with provenance */}
        {hasEvidence && (
          <div className="border border-cyan-500/30 rounded-md p-2 bg-cyan-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Search className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
              <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider">
                Evidence-Extracted Traits
              </span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1">{displayEvidence.length}</Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-[10px]">AI-extracted from {evidenceSources.length} project sources. Hover traits for provenance. These are inferred — confirm by saving DNA.</p>
                    {evidenceSources.length > 0 && (
                      <ul className="text-[9px] text-muted-foreground mt-1 space-y-0.5">
                        {evidenceSources.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex flex-wrap gap-1">
              {displayEvidence.map((t, i) => (
                <EvidenceTraitBadge key={`ev-${t.label}-${i}`} trait={t} />
              ))}
            </div>
          </div>
        )}

        {/* Transient Visual States — scene-bound, NOT permanent identity */}
        {hasTransient && (
          <div className="border border-muted-foreground/20 rounded-md p-2 bg-muted/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Eye className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Transient States (Scene-Bound)
              </span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1">{dna.transientStates.length}</Badge>
            </div>
            <p className="text-[9px] text-muted-foreground mb-1.5">
              Temporary/situational appearance cues. NOT enforced as permanent identity.
            </p>
            <div className="flex flex-wrap gap-1">
              {dna.transientStates.map((t, i) => (
                <TooltipProvider key={`tr-${i}`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-muted-foreground/20 bg-muted text-muted-foreground cursor-help">
                        {t.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-[10px]">Source: {t.evidenceSource}</p>
                      <p className="text-[9px] text-muted-foreground">Scene-bound — will not be enforced across images</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        {!hasEvidence && hasMissing && activeMarkers.length === 0 && (
          <div className="border border-dashed border-cyan-500/30 rounded-md p-2 bg-cyan-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                <span className="text-[10px] text-cyan-700 dark:text-cyan-300">
                  {dna.missingClarifications.length} gaps — auto-fill from project evidence?
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[9px] gap-1"
                onClick={handleAutoFill}
                disabled={extracting}
              >
                {extracting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />}
                Extract
              </Button>
            </div>
          </div>
        )}
        
        {/* Layer 1: Script Truth (locked) */}
        <DNASection
          title="Script Truth"
          icon={<Lock className="h-3 w-3" />}
          traits={dna.scriptTruth.traits}
          description="Explicit visual traits from canon/script — LOCKED. Cannot be overridden."
          color="text-emerald-600 dark:text-emerald-400"
          defaultOpen={true}
        />
        
        {/* Layer 2: Narrative-Critical Markers */}
        <DNASection
          title="Narrative-Critical Markers"
          icon={<Shield className="h-3 w-3" />}
          traits={dna.narrativeMarkers.traits}
          description="Visually critical traits tied to story. Protected from drift."
          color="text-amber-600 dark:text-amber-400"
          defaultOpen={true}
        />
        
        {/* Layer 5: What Must Not Drift */}
        {dna.lockedInvariants.length > 0 && (
          <div className="border border-border/50 rounded-md p-2 bg-destructive/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Lock className="h-3 w-3 text-destructive" />
              <span className="text-[10px] font-bold text-destructive uppercase tracking-wider">What Must Not Drift</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {dna.lockedInvariants.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20">
                  <Lock className="h-2.5 w-2.5" />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Layer 6: Flexible Guidance */}
        <DNASection
          title="Flexible Guidance"
          icon={<Layers className="h-3 w-3" />}
          traits={dna.flexibleAxes}
          description="Traits that may vary across images without breaking canon."
          color="text-blue-600 dark:text-blue-400"
        />
        
        {/* Layer 3: Inferred Guidance */}
        <DNASection
          title="Inferred from Role/World"
          icon={<Eye className="h-3 w-3" />}
          traits={dna.inferredGuidance.traits}
          description="Derived from character role and world context. Flexible."
          color="text-blue-500 dark:text-blue-300"
        />
        
        {/* Layer 4: Producer Guidance */}
        {dna.producerGuidance.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 py-1.5">
              <span className="text-purple-600 dark:text-purple-400 flex-shrink-0">
                <Eye className="h-3 w-3" />
              </span>
              <span className="text-[11px] font-semibold text-foreground">Producer Guidance</span>
              <Badge variant="secondary" className="text-[9px] h-4 px-1">{dna.producerGuidance.length}</Badge>
            </div>
            <div className="space-y-1">
              {dna.producerGuidance.map((g, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-1.5 px-2 py-1 rounded text-[10px] border',
                  g.classification === 'canon_compatible' 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    : g.classification === 'canon_conflicting'
                    ? 'bg-destructive/10 border-destructive/20 text-destructive'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300',
                )}>
                  {g.classification === 'canon_compatible' && <CheckCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />}
                  {g.classification === 'canon_conflicting' && <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />}
                  {g.classification === 'ambiguous' && <HelpCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />}
                  <div>
                    <span className="font-medium">{g.text}</span>
                    {g.warning && <p className="text-[9px] mt-0.5 opacity-80">{g.warning}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Contradictions */}
        {hasContradictions && (
          <div className="border border-destructive/30 rounded-md p-2 bg-destructive/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-[10px] font-bold text-destructive uppercase tracking-wider">Contradictions</span>
            </div>
            <div className="space-y-1">
              {dna.contradictions.map((c, i) => (
                <p key={i} className="text-[10px] text-destructive/90">• {c.message}</p>
              ))}
            </div>
          </div>
        )}
        
        {/* Missing Clarifications — now with resolution status */}
        {hasMissing && (
          <div className="border border-amber-500/30 rounded-md p-2 bg-amber-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <HelpCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Clarification Status</span>
            </div>
             <div className="space-y-1.5">
              {dna.missingClarifications.map((m, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px]">
                  <span className={cn('text-[8px] mt-0.5 flex-shrink-0', CLARIFICATION_STATUS_COLORS[m.status])}>
                    {m.status === 'resolved' ? '●' : m.status === 'partial' ? '◐' : '○'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-foreground">[{CATEGORY_LABELS[m.category]}]</span>
                      <span className={cn(
                        m.status === 'missing' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                      )}>
                        {m.status === 'missing' ? m.question : `${m.status === 'partial' ? 'Partial' : 'Resolved'} — via ${m.resolvedBy || 'evidence'}`}
                      </span>
                    </div>
                    {m.answerCandidate && (
                      <div className="mt-0.5 pl-0.5">
                        <span className="text-[9px] italic text-foreground/70">
                          → {m.answerCandidate.text}
                        </span>
                        <span className={cn('text-[8px] ml-1', CONFIDENCE_COLORS[m.answerCandidate.confidence])}>
                          ({m.answerCandidate.confidence}, {m.answerCandidate.basis.replace('_', ' ')})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
