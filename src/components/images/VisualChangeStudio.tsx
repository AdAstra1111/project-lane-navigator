/**
 * VisualChangeStudio — Governed what-if scenario engine with structured impact analysis.
 * Hybrid model: deterministic engine for hard contradictions + AI for nuanced analysis.
 * No silent fallbacks — explicitly labels analysis method used.
 */
import { useState } from 'react';
import {
  Palette, Send, AlertTriangle, Info,
  CheckCircle, XCircle, Eye, GitBranch, Save, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { evaluatePeriodLorePlausibility, type PlausibilitySeverity } from '@/lib/images/periodLorePlausibility';
import type { CanonConstraints } from '@/lib/images/types';

interface Props {
  projectId: string;
  characters: string[];
  locations: string[];
  canonConstraints?: CanonConstraints;
  worldRules?: string;
}

type Domain = 'character' | 'costume' | 'world' | 'production_design' | 'global_tone' | 'poster';
type Mode = 'ask' | 'preview' | 'propose_patch';
type Classification = 'safe_variation' | 'flexible_variation' | 'canon_tension' | 'canon_contradiction' | 'structural_change';

interface AffectedSystem {
  system: string;
  impact: 'regeneration_needed' | 'review_needed' | 'unaffected';
}

interface ScenarioResponse {
  proposedChange: string;
  classification: Classification;
  canonCompatibility: string;
  loreCompatibility: string;
  historicalCompatibility: string;
  affectedTraits: string[];
  affectedCanonFields: string[];
  affectedImageFamilies: string[];
  affectedDownstream: AffectedSystem[];
  recommendedPath: string;
  previewSafe: boolean;
  analysisMethod: 'rule_based' | 'ai_assisted' | 'hybrid';
  explanation: string[];
}

const DOMAIN_LABELS: Record<Domain, string> = {
  character: 'Character', costume: 'Costume', world: 'World',
  production_design: 'Production Design', global_tone: 'Global Tone', poster: 'Poster',
};

const MODE_LABELS: Record<Mode, string> = {
  ask: 'Ask (evaluate only)', preview: 'Preview (generate sample)', propose_patch: 'Propose Patch',
};

const CLASSIFICATION_CONFIG: Record<Classification, { color: string; icon: typeof CheckCircle; label: string }> = {
  safe_variation: { color: 'text-emerald-500', icon: CheckCircle, label: 'Safe Variation' },
  flexible_variation: { color: 'text-blue-500', icon: Eye, label: 'Flexible Variation' },
  canon_tension: { color: 'text-amber-500', icon: AlertTriangle, label: 'Canon Tension' },
  canon_contradiction: { color: 'text-destructive', icon: XCircle, label: 'Canon Contradiction' },
  structural_change: { color: 'text-purple-500', icon: GitBranch, label: 'Structural Change' },
};

const SEVERITY_TO_COMPAT: Record<PlausibilitySeverity, string> = {
  contradiction: 'Contradiction — impossible',
  high_tension: 'High tension — unlikely',
  mild_tension: 'Mild tension — unusual',
  valid: 'Valid',
};

export function VisualChangeStudio({ projectId, characters, locations, canonConstraints, worldRules }: Props) {
  const [domain, setDomain] = useState<Domain>('character');
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<Mode>('ask');
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [response, setResponse] = useState<ScenarioResponse | null>(null);
  
  const targets = domain === 'character' || domain === 'costume' ? characters :
    domain === 'world' || domain === 'production_design' ? locations : ['Project'];
  
  const handleSubmit = async () => {
    if (!query.trim()) return;
    setIsProcessing(true);
    setResponse(null);
    
    try {
      // Try AI-assisted analysis first
      const { data, error } = await supabase.functions.invoke('visual-change-studio', {
        body: { projectId, domain, target: target || targets[0] || 'Project', mode, query: query.trim() },
      });
      
      if (error) throw error;
      
      if (data?.response) {
        // AI succeeded — label as hybrid (AI + rule constraints)
        const aiResponse = data.response as ScenarioResponse;
        aiResponse.analysisMethod = 'hybrid';
        
        // Overlay rule-based period check
        if (canonConstraints) {
          const plausibility = evaluatePeriodLorePlausibility(query, canonConstraints, worldRules);
          if (plausibility.overallSeverity !== 'valid') {
            aiResponse.historicalCompatibility = SEVERITY_TO_COMPAT[plausibility.overallSeverity];
            for (const check of plausibility.checks) {
              aiResponse.explanation.push(`[Rule] ${check.detail}: "${check.element}" — ${check.constraint}`);
            }
            if (plausibility.overallSeverity === 'contradiction') {
              aiResponse.classification = 'canon_contradiction';
              aiResponse.previewSafe = false;
            }
          }
        }
        
        setResponse(aiResponse);
      } else {
        setResponse(classifyLocally(query, domain, canonConstraints, worldRules));
      }
    } catch {
      // AI unavailable — use rule-based only, EXPLICITLY labeled
      const local = classifyLocally(query, domain, canonConstraints, worldRules);
      setResponse(local);
      toast.info('Rule-based partial analysis only — AI assistant unavailable');
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleSaveScenario = async () => {
    if (!response) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      await (supabase as any)
        .from('visual_scenarios')
        .insert({
          project_id: projectId,
          domain, target: target || targets[0] || 'Project',
          query_text: query,
          change_json: { proposed: response.proposedChange },
          classification: response.classification,
          canon_compatibility: response.canonCompatibility,
          lore_compatibility: response.loreCompatibility,
          historical_compatibility: response.historicalCompatibility,
          impact_summary: response.recommendedPath,
          impacted_systems: response.affectedDownstream.map(s => s.system),
          recommended_path: response.recommendedPath,
          state: 'saved_guidance',
          affected_traits: response.affectedTraits,
          affected_canon_fields: response.affectedCanonFields,
          affected_image_families: response.affectedImageFamilies,
          affected_downstream: response.affectedDownstream,
          preview_safe: response.previewSafe,
          analysis_method: response.analysisMethod,
          created_by: session?.session?.user?.id,
        });
      toast.success('Scenario saved as guidance');
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`);
    }
  };
  
  return (
    <Card className="border-border/60 bg-muted/10">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground">VISUAL CHANGE STUDIO</span>
          <Badge variant="secondary" className="text-[9px]">What-if</Badge>
        </div>
        
        <p className="text-[10px] text-muted-foreground">
          Explore visual changes safely. No canon mutation until explicit apply.
        </p>
        
        {/* Controls */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Domain</label>
            <Select value={domain} onValueChange={(v: any) => setDomain(v)}>
              <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DOMAIN_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Target</label>
            <Select value={target || targets[0] || ''} onValueChange={setTarget}>
              <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {targets.map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Mode</label>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger className="h-7 text-[10px] mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Query input */}
        <div className="flex gap-2">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What if Hana were blonde? What if the village were coastal?"
            className="text-xs min-h-[40px] resize-none flex-1"
          />
          <Button size="sm" className="h-10 px-3" onClick={handleSubmit} disabled={isProcessing || !query.trim()}>
            {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </Button>
        </div>
        
        {/* Response */}
        {response && (
          <div className="border border-border/60 rounded-md p-3 bg-card/50 space-y-2">
            {/* Classification + Method badge */}
            {(() => {
              const config = CLASSIFICATION_CONFIG[response.classification];
              const Icon = config.icon;
              return (
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', config.color)} />
                  <span className={cn('text-xs font-bold', config.color)}>{config.label}</span>
                  <Badge variant="outline" className="text-[8px] h-4 ml-auto">
                    {response.analysisMethod === 'rule_based' ? '⚙ Rule-based only' :
                     response.analysisMethod === 'hybrid' ? '🔀 Hybrid' : '🤖 AI'}
                  </Badge>
                </div>
              );
            })()}
            
            {/* Details */}
            <div className="space-y-1.5 text-[10px]">
              <div>
                <span className="font-semibold text-foreground">Proposed Change:</span>
                <p className="text-muted-foreground mt-0.5">{response.proposedChange}</p>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="font-semibold text-muted-foreground">Canon:</span>
                  <p className="text-foreground">{response.canonCompatibility}</p>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">Lore:</span>
                  <p className="text-foreground">{response.loreCompatibility}</p>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">Historical:</span>
                  <p className="text-foreground">{response.historicalCompatibility}</p>
                </div>
              </div>
              
              {/* Affected traits */}
              {response.affectedTraits.length > 0 && (
                <div>
                  <span className="font-semibold text-muted-foreground">Affected DNA Traits:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {response.affectedTraits.map((t, i) => (
                      <Badge key={i} variant="outline" className="text-[9px] h-4 text-amber-600 border-amber-500/30">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Affected downstream systems */}
              {response.affectedDownstream.length > 0 && (
                <div>
                  <span className="font-semibold text-muted-foreground">Downstream Impact:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {response.affectedDownstream.map((s, i) => (
                      <Badge key={i} variant="outline" className={cn('text-[9px] h-4',
                        s.impact === 'regeneration_needed' ? 'text-destructive border-destructive/30' :
                        s.impact === 'review_needed' ? 'text-amber-600 border-amber-500/30' :
                        'text-muted-foreground border-border/50'
                      )}>
                        {s.impact === 'regeneration_needed' ? '🔄' : s.impact === 'review_needed' ? '⚠' : '✓'} {s.system}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Preview safety */}
              <div className="flex items-center gap-1">
                <span className="font-semibold text-muted-foreground">Preview-only safe:</span>
                <span className={response.previewSafe ? 'text-emerald-600' : 'text-destructive font-medium'}>
                  {response.previewSafe ? 'Yes' : 'No — requires branch mode'}
                </span>
              </div>
              
              <div>
                <span className="font-semibold text-muted-foreground">Recommended Path:</span>
                <p className="text-foreground mt-0.5">{response.recommendedPath}</p>
              </div>
              
              {/* Explanation */}
              {response.explanation.length > 0 && (
                <div className="border-t border-border/30 pt-1.5 mt-1.5">
                  <span className="font-semibold text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> Explanation
                  </span>
                  <div className="space-y-0.5 mt-0.5">
                    {response.explanation.map((e, i) => (
                      <p key={i} className="text-[9px] text-muted-foreground">• {e}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex gap-2 pt-1 border-t border-border/30">
              <Button variant="ghost" size="sm" className="text-[10px] h-6 gap-1" onClick={handleSaveScenario}>
                <Save className="h-3 w-3" /> Save as Guidance
              </Button>
              {response.classification !== 'canon_contradiction' && (
                <Button variant="ghost" size="sm" className="text-[10px] h-6 gap-1">
                  <GitBranch className="h-3 w-3" /> Create Scenario
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Local rule-based classification with structured impact analysis ──

function classifyLocally(
  query: string,
  domain: Domain,
  canonConstraints?: CanonConstraints,
  worldRules?: string,
): ScenarioResponse {
  const lower = query.toLowerCase();
  
  const hasColorChange = /\b(blonde|brunette|redhead|black hair|white hair|gray hair|blue|green|pink)\b/i.test(lower);
  const hasAgeChange = /\b(older|younger|aged|teen|child|elderly)\b/i.test(lower);
  const hasBuildChange = /\b(taller|shorter|heavier|thinner|muscular|lean)\b/i.test(lower);
  const hasLocationChange = /\b(coastal|urban|rural|desert|tropical|arctic|mountain)\b/i.test(lower);
  
  let classification: Classification = 'flexible_variation';
  let canonCompat = 'Unknown — requires canon check';
  let recommended = 'Review against canon before applying';
  const explanation: string[] = [];
  const affectedTraits: string[] = [];
  const affectedCanonFields: string[] = [];
  const affectedImageFamilies: string[] = [];
  let previewSafe = true;
  
  if (hasAgeChange) {
    classification = 'canon_tension';
    canonCompat = 'Likely conflicts with established age trait';
    recommended = 'Compare with locked invariants — age is typically locked';
    affectedTraits.push('age');
    affectedCanonFields.push('character.age');
    previewSafe = false;
    explanation.push('Age change affects locked identity trait — requires branch mode.');
  }
  if (hasBuildChange) {
    classification = 'canon_tension';
    canonCompat = 'Likely conflicts with established build';
    recommended = 'Compare with locked invariants';
    affectedTraits.push('build');
    affectedCanonFields.push('character.build');
    previewSafe = false;
    explanation.push('Build change affects identity silhouette — all body references need regeneration.');
  }
  if (hasColorChange) {
    classification = 'flexible_variation';
    canonCompat = 'May be flexible unless hair/color is locked';
    recommended = 'Check if hair/color traits are in locked invariants';
    affectedTraits.push('hair');
    affectedImageFamilies.push('identity_headshot', 'identity_profile');
    explanation.push('Hair/color change may be flexible if not in locked invariants.');
  }
  if (hasLocationChange) {
    classification = domain === 'world' ? 'structural_change' : 'flexible_variation';
    canonCompat = 'Check world rules for compatibility';
    recommended = 'Evaluate period/lore plausibility';
    affectedCanonFields.push('world.geography', 'world.architecture');
    affectedImageFamilies.push('world_establishing', 'atmospheric');
    explanation.push('Location change affects all world-establishing imagery.');
  }
  
  // Run period/lore check
  let historicalCompat = 'Requires period check';
  if (canonConstraints) {
    const plausibility = evaluatePeriodLorePlausibility(query, canonConstraints, worldRules);
    historicalCompat = SEVERITY_TO_COMPAT[plausibility.overallSeverity];
    if (plausibility.overallSeverity === 'contradiction') {
      classification = 'canon_contradiction';
      previewSafe = false;
    }
    for (const check of plausibility.checks) {
      explanation.push(`[Rule] ${check.detail}: "${check.element}" — ${check.constraint}`);
    }
  }
  
  // Downstream impact
  const affectedDownstream: AffectedSystem[] = [];
  if (domain === 'character' || domain === 'costume') {
    affectedDownstream.push(
      { system: 'Identity Lock', impact: previewSafe ? 'review_needed' : 'regeneration_needed' },
      { system: 'Character References', impact: 'regeneration_needed' },
      { system: 'Poster', impact: 'review_needed' },
      { system: 'Look Book', impact: 'review_needed' },
    );
  }
  if (domain === 'world' || domain === 'production_design') {
    affectedDownstream.push(
      { system: 'Location References', impact: 'regeneration_needed' },
      { system: 'Storyboard', impact: 'review_needed' },
      { system: 'Poster', impact: 'review_needed' },
    );
  }
  if (domain === 'global_tone') {
    affectedDownstream.push(
      { system: 'All Images', impact: 'regeneration_needed' },
      { system: 'Look Book', impact: 'regeneration_needed' },
      { system: 'Poster', impact: 'regeneration_needed' },
    );
  }
  
  return {
    proposedChange: query,
    classification,
    canonCompatibility: canonCompat,
    loreCompatibility: 'Requires evaluation',
    historicalCompatibility: historicalCompat,
    affectedTraits,
    affectedCanonFields,
    affectedImageFamilies,
    affectedDownstream,
    recommendedPath: recommended,
    previewSafe,
    analysisMethod: 'rule_based',
    explanation,
  };
}
