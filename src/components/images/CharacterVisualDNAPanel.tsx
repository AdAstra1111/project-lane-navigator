/**
 * CharacterVisualDNAPanel — Displays the full Visual DNA model for a character.
 * Shows all layers: Script Truth, Narrative Markers, Invariants, Flexible Axes,
 * Producer Guidance (classified), Contradictions, Missing Clarifications.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Shield, Lock, AlertTriangle, Eye, ChevronDown,
  Loader2, RefreshCw, Dna, CheckCircle, XCircle, HelpCircle, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useVisualDNA } from '@/hooks/useVisualDNA';
import { resolveCharacterVisualDNA, type CharacterVisualDNA, type VisualDNATrait, type ProducerGuidanceItem } from '@/lib/images/visualDNA';
import { resolveCharacterIdentity } from '@/lib/images/identityResolver';
import type { TraitCategory, TraitSource } from '@/lib/images/characterTraits';

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
  
  // Resolve DNA locally for immediate display
  useEffect(() => {
    async function resolve() {
      try {
        const identity = await resolveCharacterIdentity(projectId, characterName);
        const dna = resolveCharacterVisualDNA(characterName, canonCharacter, canonJson, userNotes, identity.locked);
        setLocalDNA(dna);
      } catch {
        // Silently fail — DNA panel will show loading state
      }
    }
    resolve();
  }, [projectId, characterName, canonCharacter, canonJson, userNotes]);
  
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
          </div>
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
        
        {/* Missing Clarifications */}
        {hasMissing && (
          <div className="border border-amber-500/30 rounded-md p-2 bg-amber-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <HelpCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Missing Clarifications</span>
            </div>
            <div className="space-y-1">
              {dna.missingClarifications.map((m, i) => (
                <p key={i} className="text-[10px] text-amber-700 dark:text-amber-300">
                  <span className="font-medium">[{CATEGORY_LABELS[m.category]}]</span> {m.question}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
