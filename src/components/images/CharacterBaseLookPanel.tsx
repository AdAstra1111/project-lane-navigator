/**
 * CharacterBaseLookPanel — Character visual identity + reference system.
 * Split into two sections:
 * 1. CHARACTER IDENTITY (top) — neutral studio-style identity anchors
 * 2. CHARACTER REFERENCES (below) — cinematic scene-based imagery
 * Identity images use generation_purpose='character_identity' and identity_* shot types.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Plus, Loader2, ChevronRight, Star, Archive, RotateCcw, Lock, ShieldCheck, AlertTriangle, CheckCircle, FileText, Save, Tag, Shield, Eye, Dna, Wand2, Download, RefreshCw } from 'lucide-react';
import { CharacterVisualDNAPanel } from './CharacterVisualDNAPanel';
import { IdentityAlignmentPanel } from './IdentityAlignmentPanel';
import { useIdentityAlignmentScoring } from '@/hooks/useIdentityAlignmentScoring';
import { resolveCharacterVisualDNA as resolveLocalDNA, deserializeBindingMarkers, deserializeEvidenceTraits } from '@/lib/images/visualDNA';
import { computeCharacterAlignment } from '@/lib/images/identityAlignmentScoring';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from './ImageSelectorGrid';
import { EntityStateVariantsPanel } from './EntityStateVariantsPanel';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useImageCuration } from '@/hooks/useImageCuration';
import { useCharacterIdentityNotes } from '@/hooks/useCharacterIdentityNotes';
import { resolveCharacterIdentity, checkIdentityNotesAgainstCanon } from '@/lib/images/identityResolver';
import { resolveCharacterTraits, detectTraitContradictions, formatTraitsForPrompt, type CharacterTrait, type TraitSource } from '@/lib/images/characterTraits';
import { deriveIdentitySignature, formatIdentitySignatureBlock, hasIdentitySignature } from '@/lib/images/identitySignature';
import { resolveCharacterVisualDNA, serializeDNAForStorage } from '@/lib/images/visualDNA';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState } from '@/lib/images/types';
import { isCharacterIdentityImage, IDENTITY_SHOT_TYPES } from '@/lib/images/types';

interface CharacterBaseLookPanelProps {
  projectId: string;
}

interface CharacterInfo {
  name: string;
  role?: string;
  importance?: number;
}

function extractCharacters(canonJson: any): CharacterInfo[] {
  if (!canonJson) return [];
  const raw = canonJson.characters;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const chars: CharacterInfo[] = raw.map((c: any, idx: number) => {
    if (typeof c === 'string') {
      return { name: c.trim(), role: undefined, importance: idx };
    }
    const name = (c.name || c.character_name || '').trim();
    if (!name || name === 'Unknown') return null;

    const role = (c.role || c.archetype || '').trim();
    let importance = idx;
    const roleLower = role.toLowerCase();
    if (roleLower.includes('protagonist') || roleLower.includes('lead') || roleLower.includes('main')) {
      importance = -10 + idx;
    } else if (roleLower.includes('antagonist') || roleLower.includes('villain')) {
      importance = -5 + idx;
    } else if (roleLower.includes('supporting') || roleLower.includes('secondary')) {
      importance = 10 + idx;
    }

    return { name, role, importance };
  }).filter(Boolean) as CharacterInfo[];

  chars.sort((a, b) => (a.importance || 0) - (b.importance || 0));
  return chars.slice(0, 10);
}

/** DNA status classification */
type DnaStatus = 'none' | 'draft' | 'approved';

interface CharacterCoverageData {
  name: string;
  identityAnchored: boolean;
  dnaStatus: DnaStatus;
}

export function CharacterBaseLookPanel({ projectId }: CharacterBaseLookPanelProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [canonJson, setCanonJson] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [coverageData, setCoverageData] = useState<CharacterCoverageData[]>([]);
  const [bootstrapping, setBootstrapping] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    async function load() {
      // Load canon characters
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();

      const cJson = data?.canon_json || null;
      setCanonJson(cJson);
      const chars = extractCharacters(cJson);
      setCharacters(chars);

      // Load visual DNA coverage
      const { data: dnaRows } = await (supabase as any)
        .from('character_visual_dna')
        .select('character_name, identity_strength')
        .eq('project_id', projectId)
        .eq('is_current', true);
      
      const dnaMap = new Map<string, any>();
      for (const d of (dnaRows || [])) {
        dnaMap.set(d.character_name, d);
      }

      // Check identity lock status from project_images
      const { data: lockedImages } = await (supabase as any)
        .from('project_images')
        .select('subject')
        .eq('project_id', projectId)
        .eq('asset_group', 'character')
        .eq('is_primary', true)
        .in('shot_type', ['identity_headshot', 'identity_full_body']);

      const lockCounts = new Map<string, number>();
      for (const img of (lockedImages || [])) {
        if (img.subject) lockCounts.set(img.subject, (lockCounts.get(img.subject) || 0) + 1);
      }

      // Build coverage data
      const coverage = chars.map(c => {
        const isLocked = (lockCounts.get(c.name) || 0) >= 2;
        const dnaRow = dnaMap.get(c.name);
        let dnaStatus: DnaStatus = 'none';
        if (dnaRow) {
          dnaStatus = dnaRow.identity_strength === 'strong' ? 'approved' : 'draft';
        }
        return { name: c.name, identityAnchored: isLocked, dnaStatus };
      });
      setCoverageData(coverage);
      setLoading(false);
    }
    load();
  }, [projectId]);

  // Bootstrap DNA for all identity-locked chars missing DNA
  const bootstrapAllDNA = useCallback(async () => {
    const eligible = coverageData.filter(c => c.identityAnchored && c.dnaStatus === 'none');
    if (eligible.length === 0) {
      toast.info('No eligible characters for DNA bootstrap');
      return;
    }
    setBootstrapping(true);
    let count = 0;
    try {
      for (const char of eligible) {
        const canonCharacter = Array.isArray((canonJson as any)?.characters)
          ? (canonJson as any).characters.find((c: any) =>
            (c.name || c.character_name || '').trim().toLowerCase() === char.name.toLowerCase()
          ) || null
          : null;

        const identity = await resolveCharacterIdentity(projectId, char.name);
        const dna = resolveCharacterVisualDNA(char.name, canonCharacter, canonJson, '', identity.locked);
        const serialized = serializeDNAForStorage(dna);

        // Get next version
        const { data: existing } = await (supabase as any)
          .from('character_visual_dna')
          .select('version_number')
          .eq('project_id', projectId)
          .eq('character_name', char.name)
          .order('version_number', { ascending: false })
          .limit(1);
        const nextVersion = (existing?.[0]?.version_number || 0) + 1;

        // Mark old as not current
        await (supabase as any)
          .from('character_visual_dna')
          .update({ is_current: false })
          .eq('project_id', projectId)
          .eq('character_name', char.name);

        const { data: session } = await supabase.auth.getSession();
        const { error } = await (supabase as any)
          .from('character_visual_dna')
          .insert({
            project_id: projectId,
            character_name: char.name,
            version_number: nextVersion,
            ...serialized,
            identity_strength: identity.locked ? 'partial' : 'weak',
            is_current: true,
            created_by: session?.session?.user?.id,
          });
        if (!error) count++;
      }
      if (count > 0) {
        toast.success(`Bootstrapped DNA drafts for ${count} character(s)`);
        qc.invalidateQueries({ queryKey: ['visual-dna'] });
        // Refresh coverage data
        const { data: dnaRows } = await (supabase as any)
          .from('character_visual_dna')
          .select('character_name, identity_strength')
          .eq('project_id', projectId)
          .eq('is_current', true);
        const dnaMap = new Map<string, any>();
        for (const d of (dnaRows || [])) dnaMap.set(d.character_name, d);
        setCoverageData(prev => prev.map(c => {
          const dnaRow = dnaMap.get(c.name);
          return { ...c, dnaStatus: dnaRow ? (dnaRow.identity_strength === 'strong' ? 'approved' : 'draft') : 'none' };
        }));
      }
    } catch (e: any) {
      toast.error(`Bootstrap failed: ${e.message}`);
    } finally {
      setBootstrapping(false);
    }
  }, [projectId, coverageData, canonJson, qc]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading characters...</span>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-muted-foreground">
          No characters found in project canon. Add characters to enable visual identity development.
        </p>
      </div>
    );
  }

  // Coverage metrics
  const canonicalCount = characters.length;
  const identityAnchoredCount = coverageData.filter(c => c.identityAnchored).length;
  const dnaDraftedCount = coverageData.filter(c => c.dnaStatus === 'draft').length;
  const dnaApprovedCount = coverageData.filter(c => c.dnaStatus === 'approved').length;
  const missingIdentity = coverageData.filter(c => !c.identityAnchored);
  const missingDNA = coverageData.filter(c => c.dnaStatus === 'none');
  const eligibleForBootstrap = coverageData.filter(c => c.identityAnchored && c.dnaStatus === 'none');

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <User className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Character Visual Identity</h3>
      </div>

      {/* Coverage Summary — 6 staged metrics */}
      <div className="grid grid-cols-3 gap-1.5 mb-1.5">
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Canonical Cast</p>
          <p className="text-sm font-semibold text-foreground">{canonicalCount}</p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Identity Anchored</p>
          <p className={cn('text-sm font-semibold', identityAnchoredCount > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
            {identityAnchoredCount}
          </p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">DNA Drafted</p>
          <p className={cn('text-sm font-semibold', dnaDraftedCount > 0 ? 'text-blue-600' : 'text-muted-foreground')}>
            {dnaDraftedCount}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">DNA Approved</p>
          <p className={cn('text-sm font-semibold', dnaApprovedCount > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
            {dnaApprovedCount}
          </p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Missing Identity</p>
          <p className={cn('text-sm font-semibold', missingIdentity.length > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
            {missingIdentity.length}
          </p>
        </div>
        <div className="bg-muted/30 rounded-md px-2 py-1.5 text-center">
          <p className="text-[10px] text-muted-foreground">Missing DNA</p>
          <p className={cn('text-sm font-semibold', missingDNA.length > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
            {missingDNA.length}
          </p>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mb-3">
        Establish locked visual identity (face + body) before generating scene imagery. Identity anchors ensure continuity across all outputs.
      </p>

      {/* DNA Bootstrap CTA */}
      {eligibleForBootstrap.length > 0 && (
        <Card className="mb-3 border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Dna className="h-3 w-3 text-blue-500" />
              <span className="text-[10px] font-medium text-blue-600">
                {eligibleForBootstrap.length} character(s) identity-locked but missing DNA
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground mb-2">
              Generate structured Visual DNA draft records from locked identity anchors and canon data.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-[10px] h-7 border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
              onClick={bootstrapAllDNA}
              disabled={bootstrapping}
            >
              {bootstrapping ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Bootstrapping...</>
              ) : (
                <><Wand2 className="h-3 w-3" /> Generate DNA Drafts ({eligibleForBootstrap.length})</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Missing Identity Block */}
      {missingIdentity.length > 0 && (
        <Card className="mb-3 border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] font-medium text-amber-600">Missing Identity Anchors</span>
            </div>
            <div className="space-y-1">
              {missingIdentity.map(char => (
                <div key={char.name} className="flex items-center justify-between text-[10px]">
                  <span className="text-foreground">{char.name}</span>
                  <span className="text-muted-foreground/60">Needs headshot + full body</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Missing DNA Block (for chars with identity but no DNA) */}
      {missingDNA.filter(c => c.identityAnchored).length > 0 && eligibleForBootstrap.length === 0 && null}

      {characters.map(char => {
        const cov = coverageData.find(c => c.name === char.name);
        return (
          <CharacterSection
            key={char.name}
            projectId={projectId}
            character={char}
            canonJson={canonJson}
            dnaStatus={cov?.dnaStatus || 'none'}
            identityAnchored={cov?.identityAnchored || false}
          />
        );
      })}
    </div>
  );
}

type CharFilter = 'all' | 'active' | 'candidate' | 'archived';

// ─── IDENTITY LOCK STATUS ────────────────────────────────────────────────────

type ContinuityStrength = 'strong' | 'partial' | 'weak';
type GenerationSafety = 'safe' | 'drift_risk' | 'unstable';

function getIdentityLockStatus(hasHeadshot: boolean, hasFullBody: boolean): {
  continuity: ContinuityStrength;
  safety: GenerationSafety;
  headshotLabel: string;
  fullBodyLabel: string;
} {
  const continuity: ContinuityStrength = hasHeadshot && hasFullBody ? 'strong' : (hasHeadshot || hasFullBody) ? 'partial' : 'weak';
  const safety: GenerationSafety = continuity === 'strong' ? 'safe' : continuity === 'partial' ? 'drift_risk' : 'unstable';
  return {
    continuity,
    safety,
    headshotLabel: hasHeadshot ? '✅ Locked' : '❌ Missing — select headshot to anchor face identity',
    fullBodyLabel: hasFullBody ? '✅ Locked' : '❌ Missing — select full body to anchor proportions',
  };
}

function IdentityLockStatusPanel({ hasHeadshot, hasFullBody }: { hasHeadshot: boolean; hasFullBody: boolean }) {
  const status = getIdentityLockStatus(hasHeadshot, hasFullBody);

  const continuityColor = {
    strong: 'text-emerald-600 dark:text-emerald-400',
    partial: 'text-amber-600 dark:text-amber-400',
    weak: 'text-destructive',
  }[status.continuity];

  const safetyColor = {
    safe: 'text-emerald-600 dark:text-emerald-400',
    drift_risk: 'text-amber-600 dark:text-amber-400',
    unstable: 'text-destructive',
  }[status.safety];

  const safetyLabel = {
    safe: '✅ Safe',
    drift_risk: '⚠ Risk of drift',
    unstable: '🚫 Unstable',
  }[status.safety];

  const continuityLabel = {
    strong: 'Strong',
    partial: 'Partial',
    weak: 'Weak',
  }[status.continuity];

  return (
    <Card className="mb-3 border-border/60 bg-muted/20">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">Identity Lock Status</span>
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Headshot:</span>
            <span className={hasHeadshot ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>{status.headshotLabel}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Full Body:</span>
            <span className={hasFullBody ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>{status.fullBodyLabel}</span>
          </div>
          <div className="border-t border-border/40 pt-1.5 mt-1.5 flex justify-between items-center">
            <span className="text-muted-foreground">Continuity Strength:</span>
            <span className={cn('font-medium', continuityColor)}>{continuityLabel}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Generation Safety:</span>
            <span className={cn('font-medium', safetyColor)}>{safetyLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── GENERATION LOCK WARNING ────────────────────────────────────────────────

function GenerationLockBadge({ identityLocked }: { identityLocked: boolean }) {
  if (identityLocked) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] text-emerald-600 dark:text-emerald-400">
        <Lock className="h-2 w-2" /> Using locked identity
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[8px] text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-2 w-2" /> Identity not fully locked — results may vary
    </span>
  );
}

// ─── CHARACTER SECTION ──────────────────────────────────────────────────────

function CharacterSection({
  projectId, character, canonJson, dnaStatus, identityAnchored,
}: {
  projectId: string;
  character: CharacterInfo;
  canonJson: Record<string, unknown> | null;
  dnaStatus: DnaStatus;
  identityAnchored: boolean;
}) {
  const [open, setOpen] = useState(false);

  const { data: allImages = [], isLoading } = useProjectImages(projectId, {
    assetGroup: 'character',
    subject: character.name,
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived'],
  });

  const identityImages = useMemo(() =>
    allImages.filter(img => isCharacterIdentityImage(img)),
    [allImages]
  );
  const referenceImages = useMemo(() =>
    allImages.filter(img => !isCharacterIdentityImage(img)),
    [allImages]
  );

  const primaryIdentityHeadshot = identityImages.find(i => i.is_primary && i.shot_type === 'identity_headshot');
  const primaryIdentityFullBody = identityImages.find(i => i.is_primary && i.shot_type === 'identity_full_body');
  const identityLocked = !!primaryIdentityHeadshot && !!primaryIdentityFullBody;

  const canonCharacter = useMemo(() => {
    if (!canonJson?.characters || !Array.isArray(canonJson.characters)) return null;
    return (canonJson.characters as any[]).find(
      (c: any) => (c.name || c.character_name || '').trim().toLowerCase() === character.name.toLowerCase()
    ) || null;
  }, [canonJson, character.name]);

  // DNA status badge
  const dnaBadge = dnaStatus === 'approved' ? (
    <Badge className="text-[7px] px-1 py-0 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
      <Dna className="h-1.5 w-1.5" /> DNA Approved
    </Badge>
  ) : dnaStatus === 'draft' ? (
    <Badge className="text-[7px] px-1 py-0 bg-blue-500/15 text-blue-600 border-blue-500/30 gap-0.5">
      <Dna className="h-1.5 w-1.5" /> DNA Draft
    </Badge>
  ) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-md hover:bg-muted/50 transition-colors text-left group">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {primaryIdentityHeadshot?.signedUrl ? (
            <img src={primaryIdentityHeadshot.signedUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{character.name}</span>
          {character.role && (
            <span className="text-[10px] text-muted-foreground ml-1.5">({character.role})</span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {identityLocked ? (
              <Badge className="text-[8px] px-1 py-0 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
                <Lock className="h-2 w-2" /> Identity Locked
              </Badge>
            ) : identityImages.length > 0 ? (
              <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5 text-amber-600">
                <AlertTriangle className="h-2 w-2" /> Incomplete
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground/60">no identity yet</span>
            )}
            {dnaBadge}
            {referenceImages.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{referenceImages.length} refs</span>
            )}
          </div>
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <CharacterIdentitySection
          projectId={projectId}
          character={character}
          identityImages={identityImages}
          identityLocked={identityLocked}
          canonJson={canonJson}
          canonCharacter={canonCharacter}
          dnaStatus={dnaStatus}
        />

        <CharacterReferenceSection
          projectId={projectId}
          character={character}
          referenceImages={referenceImages}
          identityLocked={identityLocked}
        />

        {allImages.length > 0 && (
          <EntityStateVariantsPanel
            projectId={projectId}
            entityType="character"
            entityName={character.name}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── IDENTITY SECTION ────────────────────────────────────────────────────────

function CharacterIdentitySection({
  projectId, character, identityImages, identityLocked, canonJson, canonCharacter, dnaStatus,
}: {
  projectId: string;
  character: CharacterInfo;
  identityImages: ProjectImage[];
  identityLocked: boolean;
  canonJson: Record<string, unknown> | null;
  canonCharacter: Record<string, unknown> | null;
  dnaStatus: DnaStatus;
}) {
  const [generating, setGenerating] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [localNotes, setLocalNotes] = useState('');
  const [localCanonCheck, setLocalCanonCheck] = useState<{ status: string; messages: string[] }>({ status: 'unchecked', messages: [] });
  const [bootstrappingSingle, setBootstrappingSingle] = useState(false);
  const [startingFresh, setStartingFresh] = useState(false);
  const [downloadingPack, setDownloadingPack] = useState(false);
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);
  const { notes: savedNotes, canonCheckStatus, canonCheckMessages, isSaving, save: saveNotes } = useCharacterIdentityNotes(projectId, character.name);

  // Resolve local DNA for scoring
  const localDNAForScoring = useMemo(() => {
    try {
      return resolveLocalDNA(character.name, canonCharacter, canonJson, '', false);
    } catch { return null; }
  }, [character.name, canonCharacter, canonJson]);

  // Fetch current DNA record for composite signature
  const [dnaRecord, setDnaRecord] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('character_visual_dna')
        .select('*')
        .eq('project_id', projectId)
        .eq('character_name', character.name)
        .eq('is_current', true)
        .maybeSingle();
      setDnaRecord(data);
    })();
  }, [projectId, character.name]);

  // Identity Alignment Scoring
  const { alignment } = useIdentityAlignmentScoring(
    projectId, character.name, identityImages, localDNAForScoring, dnaRecord,
  );

  useEffect(() => {
    setLocalNotes(savedNotes);
    setLocalCanonCheck({ status: canonCheckStatus, messages: canonCheckMessages });
  }, [savedNotes, canonCheckStatus, canonCheckMessages]);

  const headshots = identityImages.filter(i => i.shot_type === 'identity_headshot');
  const profiles = identityImages.filter(i => i.shot_type === 'identity_profile');
  const fullBodies = identityImages.filter(i => i.shot_type === 'identity_full_body');

  const primaryHeadshot = identityImages.find(i => i.is_primary && i.shot_type === 'identity_headshot');
  const primaryProfile = identityImages.find(i => i.is_primary && i.shot_type === 'identity_profile');
  const primaryFullBody = identityImages.find(i => i.is_primary && i.shot_type === 'identity_full_body');

  // Slot status summary
  const slotStatus = useMemo(() => {
    const slots = [
      { label: 'Headshot', primary: primaryHeadshot, candidates: headshots.length },
      { label: 'Profile', primary: primaryProfile, candidates: profiles.length },
      { label: 'Full Body', primary: primaryFullBody, candidates: fullBodies.length },
    ];
    return slots;
  }, [primaryHeadshot, primaryProfile, primaryFullBody, headshots.length, profiles.length, fullBodies.length]);

  const runCanonCheck = useCallback(() => {
    const result = checkIdentityNotesAgainstCanon(localNotes, canonCharacter as any, canonJson);
    setLocalCanonCheck(result);
    return result;
  }, [localNotes, canonCharacter, canonJson]);

  const handleSaveNotes = useCallback(() => {
    const checkResult = runCanonCheck();
    saveNotes({
      notes: localNotes,
      canonCheckStatus: checkResult.status,
      canonCheckMessages: checkResult.messages,
    });
  }, [localNotes, runCanonCheck, saveNotes]);

  const canonFactsString = useMemo(() => {
    if (!canonCharacter) return '';
    const parts: string[] = [];
    if (canonCharacter.name) parts.push(`Name: ${canonCharacter.name}`);
    if (canonCharacter.role) parts.push(`Role: ${canonCharacter.role}`);
    if (canonCharacter.traits) parts.push(`Traits: ${canonCharacter.traits}`);
    if (canonCharacter.description) parts.push(`Description: ${canonCharacter.description}`);
    if (canonCharacter.appearance) parts.push(`Appearance: ${canonCharacter.appearance}`);
    if (canonCharacter.age) parts.push(`Age: ${canonCharacter.age}`);
    if (canonCharacter.physical) parts.push(`Physical: ${canonCharacter.physical}`);
    return parts.join('. ');
  }, [canonCharacter]);

  const resolvedTraits = useMemo(() => {
    return resolveCharacterTraits(canonCharacter as any, canonJson, localNotes);
  }, [canonCharacter, canonJson, localNotes]);

  const traitContradictions = useMemo(() => {
    return detectTraitContradictions(resolvedTraits);
  }, [resolvedTraits]);

  const traitsPromptBlock = useMemo(() => {
    return formatTraitsForPrompt(resolvedTraits);
  }, [resolvedTraits]);

  const identitySignature = useMemo(() => deriveIdentitySignature(resolvedTraits), [resolvedTraits]);
  const identitySignatureBlock = useMemo(() => formatIdentitySignatureBlock(identitySignature), [identitySignature]);

  // Single character DNA bootstrap
  const handleBootstrapDNA = useCallback(async () => {
    setBootstrappingSingle(true);
    try {
      const identity = await resolveCharacterIdentity(projectId, character.name);
      const dna = resolveCharacterVisualDNA(character.name, canonCharacter, canonJson, localNotes, identity.locked);
      const serialized = serializeDNAForStorage(dna);

      const { data: existing } = await (supabase as any)
        .from('character_visual_dna')
        .select('version_number')
        .eq('project_id', projectId)
        .eq('character_name', character.name)
        .order('version_number', { ascending: false })
        .limit(1);
      const nextVersion = (existing?.[0]?.version_number || 0) + 1;

      await (supabase as any)
        .from('character_visual_dna')
        .update({ is_current: false })
        .eq('project_id', projectId)
        .eq('character_name', character.name);

      const { data: session } = await supabase.auth.getSession();
      await (supabase as any)
        .from('character_visual_dna')
        .insert({
          project_id: projectId,
          character_name: character.name,
          version_number: nextVersion,
          ...serialized,
          identity_strength: identity.locked ? 'partial' : 'weak',
          is_current: true,
          created_by: session?.session?.user?.id,
        });

      toast.success(`DNA draft created for ${character.name}`);
      qc.invalidateQueries({ queryKey: ['visual-dna'] });
    } catch (e: any) {
      toast.error(`DNA bootstrap failed: ${e.message}`);
    } finally {
      setBootstrappingSingle(false);
    }
  }, [projectId, character.name, canonCharacter, canonJson, localNotes, qc]);

  const generateIdentity = useCallback(async () => {
    if (generating) return;

    if (identityLocked && localCanonCheck.status === 'contradiction') {
      toast.error('Cannot generate: identity notes contradict canon. Fix notes first.');
      return;
    }

    setGenerating(true);
    try {
      let identityAnchorPaths: { headshot?: string; fullBody?: string } | null = null;
      if (identityLocked && primaryHeadshot && primaryFullBody) {
        identityAnchorPaths = {
          headshot: primaryHeadshot.storage_path,
          fullBody: primaryFullBody.storage_path,
        };
      }

      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'character',
          count: 3,
          character_name: character.name,
          asset_group: 'character',
          pack_mode: true,
          identity_mode: true,
          identity_anchor_paths: identityAnchorPaths,
          identity_notes: localNotes.trim() || null,
          identity_canon_facts: canonFactsString || null,
          identity_traits_block: traitsPromptBlock || null,
          identity_signature_block: identitySignatureBlock || null,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      const lockedUsed = results.some((r: any) => r.identity_locked);
      if (successCount > 0) {
        const lockLabel = lockedUsed ? ' (from locked identity)' : '';
        toast.success(`Generated ${successCount} identity images for ${character.name}${lockLabel}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      } else {
        const errors = results.filter((r: any) => r.error).map((r: any) => r.error).join('; ');
        toast.error(`No identity images generated${errors ? ': ' + errors : ''}`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate identity pack');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc, identityLocked, primaryHeadshot, primaryFullBody, localNotes, canonFactsString, localCanonCheck.status, traitsPromptBlock, identitySignatureBlock]);

  // ── Start Fresh Identity: archive all identity images, clear primaries, regenerate ──
  const handleStartFresh = useCallback(async (andGenerate: boolean) => {
    if (startingFresh || generating) return;
    setStartingFresh(true);
    try {
      // Step 1: Archive all existing identity images for this character
      const identityIds = identityImages.map(i => i.id);
      if (identityIds.length > 0) {
        await (supabase as any)
          .from('project_images')
          .update({
            curation_state: 'archived',
            is_active: false,
            is_primary: false,
            archived_from_active_at: new Date().toISOString(),
          })
          .eq('project_id', projectId)
          .eq('asset_group', 'character')
          .eq('subject', character.name)
          .in('shot_type', ['identity_headshot', 'identity_profile', 'identity_full_body']);
      }

      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      toast.success(`Archived ${identityIds.length} identity images for ${character.name}`);

      // Step 2: Generate fresh pack if requested (no stale anchors — fresh_identity_mode)
      if (andGenerate) {
        const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
          body: {
            project_id: projectId,
            section: 'character',
            count: 3,
            character_name: character.name,
            asset_group: 'character',
            pack_mode: true,
            identity_mode: true,
            fresh_identity_mode: true, // Explicitly exclude stale anchors
            identity_anchor_paths: null, // No reuse of old anchors
            identity_notes: localNotes.trim() || null,
            identity_canon_facts: canonFactsString || null,
            identity_traits_block: traitsPromptBlock || null,
            identity_signature_block: identitySignatureBlock || null,
          },
        });
        if (error) throw error;
        const results = data?.results || [];
        const successCount = results.filter((r: any) => r.status === 'ready').length;
        if (successCount > 0) {
          toast.success(`Generated ${successCount} fresh identity images for ${character.name}`);
        }
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      }
    } catch (e: any) {
      toast.error(`Start fresh failed: ${e.message}`);
    } finally {
      setStartingFresh(false);
    }
  }, [startingFresh, generating, identityImages, projectId, character.name, qc, localNotes, canonFactsString, traitsPromptBlock, identitySignatureBlock]);

  // ── Download identity pack (current primaries or all active identity images) ──
  const handleDownloadIdentityPack = useCallback(async () => {
    const downloadTargets = [primaryHeadshot, primaryProfile, primaryFullBody].filter(Boolean) as ProjectImage[];
    if (downloadTargets.length === 0) {
      toast.info('No primary identity images to download');
      return;
    }
    setDownloadingPack(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(`${character.name.replace(/\s+/g, '_')}_identity`)!;

      for (const img of downloadTargets) {
        const url = img.signedUrl;
        if (!url) continue;
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          folder.file(`${img.shot_type || 'image'}.${ext}`, blob);
        } catch {
          console.warn(`Failed to fetch identity image ${img.id}`);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `${character.name.replace(/\s+/g, '_')}_identity_pack.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${downloadTargets.length} identity images`);
    } catch (e: any) {
      toast.error('Download failed: ' + (e.message || 'Unknown error'));
    } finally {
      setDownloadingPack(false);
    }
  }, [primaryHeadshot, primaryProfile, primaryFullBody, character.name]);

  // ── Auto-fill Best Matches: uses Identity Alignment Scoring Engine ──
  const handleAutoFillBest = useCallback(async () => {
    if (!alignment) {
      toast.info('No alignment data — generate candidates first');
      return;
    }

    const IDENTITY_SLOTS = ['identity_headshot', 'identity_profile', 'identity_full_body'] as const;
    let selected = 0;

    for (const slot of IDENTITY_SLOTS) {
      const slotImages = identityImages.filter(i => i.shot_type === slot);
      if (slotImages.length === 0) continue;
      const existingPrimary = slotImages.find(i => i.is_primary);
      if (existingPrimary) continue;

      // Use scoring engine recommendation
      const slotRec = alignment.slots.find(s => s.slot === slot);
      const best = slotRec?.bestCandidate;
      if (!best || !best.eligible || best.confidence === 'low') continue;

      // Clear existing primaries in this slot
      await (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('asset_group', 'character')
        .eq('subject', character.name)
        .eq('shot_type', slot)
        .eq('is_primary', true);

      // Set scored best as primary
      await (supabase as any)
        .from('project_images')
        .update({ is_primary: true, curation_state: 'active', is_active: true })
        .eq('id', best.candidateId);

      // Demote others
      const others = slotImages.filter(i => i.id !== best.candidateId);
      for (const other of others) {
        await (supabase as any)
          .from('project_images')
          .update({ is_primary: false, curation_state: 'candidate', is_active: false })
          .eq('id', other.id);
      }

      selected++;
    }

    if (selected > 0) {
      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      toast.success(`Auto-selected best match for ${selected} identity slot${selected !== 1 ? 's' : ''} (scored)`);
    } else {
      toast.info('All identity slots already have primaries or no confident candidates available');
    }
  }, [identityImages, projectId, character.name, qc, alignment]);

  const generateButtonLabel = identityImages.length === 0
    ? 'Generate Identity Pack (headshot + profile + full body)'
    : identityLocked
      ? 'Generate More from Locked Identity'
      : 'Generate More Identity Candidates';

  const isContradiction = localCanonCheck.status === 'contradiction';
  const generateDisabled = generating || startingFresh || (identityLocked && isContradiction);

  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
          Character Identity
        </span>
        {identityLocked ? (
          <Badge className="text-[7px] px-1 py-0 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-0.5">
            <Lock className="h-1.5 w-1.5" /> Locked
          </Badge>
        ) : identityImages.length > 0 ? (
          <Badge variant="secondary" className="text-[7px] px-1 py-0 gap-0.5 text-amber-600">
            <AlertTriangle className="h-1.5 w-1.5" /> Incomplete
          </Badge>
        ) : null}
      </div>

      {/* Identity Lock Status */}
      <IdentityLockStatusPanel
        hasHeadshot={!!primaryHeadshot}
        hasFullBody={!!primaryFullBody}
      />

      {/* Identity Slot Status — strict 1/1 per slot */}
      {identityImages.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {slotStatus.map(s => (
            <div key={s.label} className="rounded-md bg-muted/30 px-2 py-1.5 text-center">
              <p className="text-[8px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className={cn('text-[10px] font-semibold', s.primary ? 'text-emerald-600' : 'text-amber-600')}>
                {s.primary ? '1/1 Primary' : `0/1 Primary`}
              </p>
              {s.candidates > (s.primary ? 1 : 0) && (
                <p className="text-[8px] text-muted-foreground">{s.candidates - (s.primary ? 1 : 0)} candidates</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* DNA Bootstrap CTA for this character */}
      {identityLocked && dnaStatus === 'none' && (
        <Card className="mb-3 border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Dna className="h-3 w-3 text-blue-500" />
              <span className="text-[10px] font-medium text-blue-600">No structured DNA draft yet</span>
            </div>
            <p className="text-[9px] text-muted-foreground mb-2">
              Identity locked but no Visual DNA record exists. Bootstrap a draft from locked identity and canon data.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-[10px] h-7 border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
              onClick={handleBootstrapDNA}
              disabled={bootstrappingSingle}
            >
              {bootstrappingSingle ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Bootstrapping...</>
              ) : (
                <><Wand2 className="h-3 w-3" /> Generate DNA Draft from Locked Identity</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Identity Alignment Scoring */}
      {alignment && identityImages.length > 0 && (
        <IdentityAlignmentPanel alignment={alignment} />
      )}

      {/* Character Visual DNA Panel */}
      <CharacterVisualDNAPanel
        projectId={projectId}
        characterName={character.name}
        canonCharacter={canonCharacter as any}
        canonJson={canonJson}
        userNotes={localNotes}
      />
      />

      {/* Identity Notes */}
      <div className="mb-3">
        <button
          onClick={() => setNotesOpen(!notesOpen)}
          className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <FileText className="h-2.5 w-2.5" />
          Identity Notes {localNotes.trim() ? '(saved)' : '(optional)'}
          {localCanonCheck.status === 'pass' && <CheckCircle className="h-2.5 w-2.5 text-emerald-500" />}
          {localCanonCheck.status === 'uncertain' && <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />}
          {localCanonCheck.status === 'contradiction' && <AlertTriangle className="h-2.5 w-2.5 text-destructive" />}
        </button>
        {notesOpen && (
          <div className="space-y-1.5">
            <Textarea
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
              placeholder="Optional: face shape, casting-type feel, hair, body type, wardrobe baseline..."
              className="text-[10px] min-h-[60px] bg-muted/30 border-border/50 resize-none"
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={handleSaveNotes} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                Save Notes
              </Button>
              {localCanonCheck.status === 'pass' && (
                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                  <CheckCircle className="h-2.5 w-2.5" /> Canon compatible
                </span>
              )}
              {localCanonCheck.status === 'uncertain' && (
                <span className="text-[9px] text-amber-600 flex items-center gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" /> Check recommended
                </span>
              )}
              {localCanonCheck.status === 'contradiction' && (
                <span className="text-[9px] text-destructive flex items-center gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" /> Contradicts canon
                </span>
              )}
            </div>
            {localCanonCheck.messages.length > 0 && (
              <div className="space-y-0.5">
                {localCanonCheck.messages.map((msg, i) => (
                  <p key={i} className={cn(
                    'text-[9px]',
                    localCanonCheck.status === 'contradiction' ? 'text-destructive' : 'text-amber-600',
                  )}>• {msg}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Identity Headshots */}
      {headshots.length > 0 && (
        <div className="mb-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
            Headshots
          </p>
          <ImageSelectorGrid projectId={projectId} images={headshots} showShotTypes showCurationControls showProvenance />
        </div>
      )}
      {profiles.length > 0 && (
        <div className="mb-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
            Profile Angles
          </p>
          <ImageSelectorGrid projectId={projectId} images={profiles} showShotTypes showCurationControls showProvenance />
        </div>
      )}
      {fullBodies.length > 0 && (
        <div className="mb-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
            Full Body
          </p>
          <ImageSelectorGrid projectId={projectId} images={fullBodies} showShotTypes showCurationControls showProvenance />
        </div>
      )}

      {/* ── Identity Action Bar ── */}
      <div className="space-y-1.5">
        {/* Row 1: Generate + Auto-fill */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7 flex-1"
            onClick={generateIdentity}
            disabled={generateDisabled}
          >
            {generating ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
            ) : (
              <><Plus className="h-3 w-3" /> {generateButtonLabel}</>
            )}
          </Button>

          {identityImages.length > 0 && !identityLocked && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-[10px] h-7"
              onClick={handleAutoFillBest}
              title="Select the best candidate as primary for each unfilled identity slot"
            >
              <Wand2 className="h-2.5 w-2.5" />
              Auto-fill Best
            </Button>
          )}
        </div>

        {/* Row 2: Start Fresh + Download */}
        {identityImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-[10px] h-7 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              onClick={() => handleStartFresh(false)}
              disabled={startingFresh || generating}
              title="Archive all existing identity images and clear slot bindings"
            >
              {startingFresh ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
              Start Fresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-[10px] h-7 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              onClick={() => handleStartFresh(true)}
              disabled={startingFresh || generating}
              title="Archive old identity images and generate a fresh pack from current canon/DNA"
            >
              {startingFresh ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <><RefreshCw className="h-2.5 w-2.5" /><Plus className="h-2 w-2" /></>}
              Start Fresh + Generate
            </Button>
            {(primaryHeadshot || primaryProfile || primaryFullBody) && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-[10px] h-7"
                onClick={handleDownloadIdentityPack}
                disabled={downloadingPack}
                title="Download current primary identity images as a zip pack"
              >
                {downloadingPack ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />}
                Download Pack
              </Button>
            )}
          </div>
        )}
      </div>

      {identityImages.length > 0 && <GenerationLockBadge identityLocked={identityLocked} />}
    </div>
  );
}

// ─── CHARACTER REFERENCES ────────────────────────────────────────────────────

function CharacterReferenceSection({
  projectId, character, referenceImages, identityLocked,
}: {
  projectId: string;
  character: CharacterInfo;
  referenceImages: ProjectImage[];
  identityLocked: boolean;
}) {
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<CharFilter>('all');
  const qc = useQueryClient();
  const { setPrimary, setCurationState, updating } = useImageCuration(projectId);

  const filtered = useMemo(() => {
    if (filter === 'all') return referenceImages.filter(i => i.curation_state !== 'rejected');
    return referenceImages.filter(i => i.curation_state === filter);
  }, [referenceImages, filter]);

  const activeCount = referenceImages.filter(i => i.curation_state === 'active').length;
  const candidateCount = referenceImages.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = referenceImages.filter(i => i.curation_state === 'archived').length;

  const generateRef = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: 'character',
          count: 4,
          character_name: character.name,
          asset_group: 'character',
          pack_mode: true,
          base_look_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} reference images for ${character.name}`);
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      } else {
        toast.error('No reference images generated');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate references');
    } finally {
      setGenerating(false);
    }
  }, [projectId, character.name, generating, qc]);

  if (referenceImages.length === 0 && !identityLocked) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
          Character References
        </span>
        {referenceImages.length > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0">{referenceImages.length}</Badge>
        )}
      </div>

      {referenceImages.length > 0 && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {(['all', 'active', 'candidate', 'archived'] as CharFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                filter === f
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground'
              )}
            >
              {f}
              {f === 'active' && activeCount > 0 && ` (${activeCount})`}
              {f === 'candidate' && candidateCount > 0 && ` (${candidateCount})`}
              {f === 'archived' && archivedCount > 0 && ` (${archivedCount})`}
            </button>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <ImageSelectorGrid projectId={projectId} images={filtered} showShotTypes showCurationControls showProvenance />
      )}

      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs h-7 w-full mt-2"
        onClick={generateRef}
        disabled={generating}
      >
        {generating ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
        ) : (
          <><Plus className="h-3 w-3" /> Generate Reference Pack</>
        )}
      </Button>

      <GenerationLockBadge identityLocked={identityLocked} />
    </div>
  );
}
