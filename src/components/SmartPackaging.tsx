import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Users, Star, User, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import { CharacterSelector } from '@/components/CharacterSelector';
import { TalentTriageBoard } from '@/components/TalentTriageBoard';
import { TalentSearch } from '@/components/TalentSearch';
import { useTalentTriage } from '@/hooks/useTalentTriage';
import { useProjectCast, useProjectHODs } from '@/hooks/useProjectAttachments';
import { usePersonImage } from '@/hooks/usePersonImage';
import type { ScriptCharacter } from '@/hooks/useScriptCharacters';

interface PackagingSuggestion {
  name: string;
  role: string;
  rationale: string;
  market_value: string;
  availability_window: string;
}

export type PackagingMode = 'cast' | 'crew';

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  budgetRange: string;
  tone: string;
  assignedLane: string | null;
  mode?: PackagingMode;
  scriptCharacters?: ScriptCharacter[];
  scriptCharactersLoading?: boolean;
}

function SuggestionAvatar({ name }: { name: string }) {
  const imageUrl = usePersonImage(name);
  return (
    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
      {imageUrl ? (
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <User className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

export function SmartPackaging({ projectId, projectTitle, format, genres, budgetRange, tone, assignedLane, mode = 'cast', scriptCharacters = [], scriptCharactersLoading }: Props) {
  const [suggestions, setSuggestions] = useState<PackagingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);
  const [targetCharacter, setTargetCharacter] = useState<ScriptCharacter | null>(null);
  const [targetDepartment, setTargetDepartment] = useState<string | null>(null);
  const [customBrief, setCustomBrief] = useState('');

  const triage = useTalentTriage(projectId);
  const { cast, addCast } = useProjectCast(projectId);
  const { hods, addHOD } = useProjectHODs(projectId);

  const castNames = useMemo(() => new Set(cast.map(c => c.actor_name.toLowerCase())), [cast]);
  const hodNames = useMemo(() => new Set(hods.map(h => h.person_name.toLowerCase())), [hods]);
  const existingWishlistNames = mode === 'cast' ? castNames : hodNames;

  // Filter triage items by mode: cast tab sees cast items, crew tab sees crew/director items
  const isCastType = (type: string) => type === 'cast' || type === 'actor';
  const isCrewType = (type: string) => type === 'crew' || type === 'director' || type === 'hod';
  const modeFilter = mode === 'cast' ? isCastType : isCrewType;
  const filteredItems = triage.items.filter(i => modeFilter(i.person_type));
  const filteredByStatus = (status: string) =>
    filteredItems.filter(i => i.status === status).sort((a, b) => status === 'shortlist' ? a.priority_rank - b.priority_rank : 0);

  const projectContext = { title: projectTitle, format, budget_range: budgetRange, genres };

  const fetchSuggestions = async (clearFirst = false) => {
    setLoading(true);
    try {
      // Snapshot names to exclude BEFORE deleting unsorted items
      // Only exclude passed/no'd names from AI — let shortlisted/maybe names be excluded via dedup only
      const excludeNames = [...filteredByStatus('pass'), ...filteredByStatus('no')].map(p => p.person_name);

      // Track names that should NOT be re-added as triage items (shortlisted, maybe, etc.)
      const survivingNames = new Set(
        filteredItems
          .filter(i => i.status !== 'unsorted')
          .map(i => i.person_name.toLowerCase())
      );

      // If clearing, delete unsorted triage items for this mode first
      if (clearFirst) {
        const unsorted = filteredByStatus('unsorted');
        // Delete in parallel for speed
        await Promise.all(unsorted.map(item => triage.deleteItem(item.id)));
        setSuggestions([]);
      }

      const { data, error } = await supabase.functions.invoke('smart-packaging', {
        body: { projectTitle, format, genres, budgetRange, tone, assignedLane, mode, maxSuggestions: 10, excludeNames: excludeNames.length > 0 ? excludeNames : undefined, customBrief: customBrief.trim().slice(0, 500) || undefined, targetDepartment: mode === 'crew' ? targetDepartment : undefined, targetCharacter: (mode === 'cast' && targetCharacter) ? { name: targetCharacter.name, description: targetCharacter.description, scene_count: targetCharacter.scene_count, gender: targetCharacter.gender } : undefined },
      });
      if (error) throw error;
      const results: PackagingSuggestion[] = data?.suggestions || [];
      setSuggestions(results);

      // Auto-save to triage (skip names that already exist in non-unsorted statuses)
      const newItems = results
        .filter(s => !survivingNames.has(s.name.toLowerCase()))
        .map(s => ({
          person_name: s.name,
          person_type: mode === 'crew' ? 'crew' : 'cast',
          suggestion_source: 'smart-packaging',
          suggestion_context: s.rationale,
          role_suggestion: s.role,
          creative_fit: s.rationale,
          commercial_case: `Market value: ${s.market_value} · Window: ${s.availability_window}`,
        }));
      if (newItems.length > 0) {
        await triage.addItems(newItems);
        toast.success(`${newItems.length} new suggestion${newItems.length > 1 ? 's' : ''} added to triage`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to get packaging suggestions');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReplacement = async (item: any) => {
    setReplacementLoading(true);
    try {
      // Get all passed and no'd names to exclude
      const excludeNames = [...filteredByStatus('pass'), ...filteredByStatus('no')].map(p => p.person_name);
      const { data, error } = await supabase.functions.invoke('smart-packaging', {
        body: {
          projectTitle, format, genres, budgetRange, tone, assignedLane, mode,
          excludeNames,
          replacementFor: item.person_name,
          maxSuggestions: 1,
        },
      });
      if (error) throw error;
      const results: PackagingSuggestion[] = data?.suggestions || [];
      if (results.length > 0) {
        const s = results[0];
        await triage.addItems([{
          person_name: s.name,
          person_type: mode === 'crew' ? 'crew' : 'cast',
          suggestion_source: 'smart-packaging',
          suggestion_context: s.rationale,
          role_suggestion: s.role,
          creative_fit: s.rationale,
          commercial_case: `Market value: ${s.market_value} · Window: ${s.availability_window}`,
        }]);
        toast.success(`Replacement suggested: ${s.name}`);
      } else {
        toast.info('No additional suggestions available');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to get replacement');
    } finally {
      setReplacementLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground">
            {mode === 'crew' ? 'Smart Crew Suggestions' : 'Smart Cast Suggestions'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {filteredItems.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => fetchSuggestions(true)} disabled={loading || replacementLoading} title="Clear unsorted & get fresh suggestions">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => fetchSuggestions(false)} disabled={loading || replacementLoading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
            {filteredItems.length > 0 ? 'Get More' : 'Get Suggestions'}
          </Button>
        </div>
      </div>

      {mode === 'cast' && (
        <>
          <div className="mb-3">
            <CharacterSelector
              characters={scriptCharacters}
              selected={targetCharacter}
              onSelect={setTargetCharacter}
              loading={scriptCharactersLoading}
            />
          </div>
          {targetCharacter && (
            <div className="mb-3 bg-muted/30 rounded-lg px-3 py-2 text-xs">
              <span className="font-medium text-foreground">Casting for: </span>
              <span className="text-primary font-semibold">{targetCharacter.name}</span>
              {targetCharacter.description && (
                <p className="text-muted-foreground mt-1">{targetCharacter.description}</p>
              )}
            </div>
          )}
        </>
      )}

      {mode === 'crew' && (
        <div className="mb-3">
          <Select
            value={targetDepartment || 'all'}
            onValueChange={v => setTargetDepartment(v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="all">All departments</SelectItem>
              <SelectItem value="Writer">Writer</SelectItem>
              <SelectItem value="Director">Director</SelectItem>
              <SelectItem value="Director of Photography">Director of Photography</SelectItem>
              <SelectItem value="Producer">Producer</SelectItem>
              <SelectItem value="Line Producer">Line Producer</SelectItem>
              <SelectItem value="Editor">Editor</SelectItem>
              <SelectItem value="Composer">Composer</SelectItem>
              <SelectItem value="Production Designer">Production Designer</SelectItem>
              <SelectItem value="Costume Designer">Costume Designer</SelectItem>
              <SelectItem value="VFX Supervisor">VFX Supervisor</SelectItem>
              <SelectItem value="Sound Designer">Sound Designer</SelectItem>
              <SelectItem value="Casting Director">Casting Director</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mb-4">
        <Textarea
          placeholder={mode === 'crew'
            ? 'e.g. "Looking for a DP with experience in handheld naturalistic work, ideally European"'
            : 'e.g. "English actors who are tall and can play American, strong comedic range"'}
          value={customBrief}
          onChange={e => setCustomBrief(e.target.value)}
          className="text-sm min-h-[60px] resize-none bg-background"
          maxLength={500}
        />
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{customBrief.length}/500</p>
      </div>

      {/* TMDb talent search */}
      <TalentSearch
        mode={mode}
        onAddToTriage={triage.addItems}
        onAddToWishlist={(input) => {
          if (mode === 'cast') {
            addCast.mutate({ actor_name: input.actor_name, role_name: input.role_name, status: 'wishlist' });
          } else {
            addHOD.mutate({ person_name: input.actor_name, department: input.role_name || 'Director', status: 'wishlist' });
          }
        }}
        existingNames={new Set(filteredItems.map(i => i.person_name.toLowerCase()))}
        existingCastNames={existingWishlistNames}
        projectContext={projectContext}
      />

      {/* Show triage board if there are items */}
      <TalentTriageBoard
        unsorted={filteredByStatus('unsorted')}
        shortlisted={filteredByStatus('shortlist')}
        maybes={filteredByStatus('maybe')}
        nos={filteredByStatus('no')}
        passed={filteredByStatus('pass')}
        onUpdateStatus={triage.updateStatus}
        onUpdatePriority={triage.updatePriorityRank}
        onDelete={triage.deleteItem}
        onRequestReplacement={handleRequestReplacement}
        onPromoteToCast={(item) => {
          const isCrew = item.person_type === 'crew' || item.person_type === 'hod' || item.person_type === 'director';
          if (isCrew) {
            addHOD.mutate({
              person_name: item.person_name,
              department: item.role_suggestion || 'Director',
              status: 'wishlist',
              notes: [item.creative_fit, item.commercial_case].filter(Boolean).join(' · '),
            });
          } else {
            addCast.mutate({
              actor_name: item.person_name,
              role_name: item.role_suggestion || '',
              status: 'wishlist',
              notes: [item.creative_fit, item.commercial_case].filter(Boolean).join(' · '),
            });
          }
          triage.deleteItem(item.id);
        }}
        projectContext={projectContext}
      />

      {/* Show raw suggestions only if no triage items yet (first-time preview) */}
      {filteredItems.length === 0 && suggestions.length > 0 && (
        <div className="space-y-3">
          {suggestions.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
               className="border border-border rounded-lg p-4"
             >
               <div className="flex items-start gap-3">
                 <SuggestionAvatar name={s.name} />
                 <div className="flex-1 min-w-0">
                   <div className="flex items-center gap-2 mb-1">
                     <button
                       onClick={() => setSelectedPerson({ name: s.name, reason: `${s.role} · ${s.rationale}` })}
                       className="font-semibold text-sm text-foreground hover:text-primary transition-colors cursor-pointer"
                     >
                       {s.name}
                     </button>
                     <span className="text-xs text-muted-foreground">· {s.role}</span>
                   </div>
                   <p className="text-sm text-muted-foreground leading-relaxed">{s.rationale}</p>
                   <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                     <span>Market Value: <span className="text-foreground font-medium">{s.market_value}</span></span>
                     <span>Window: <span className="text-foreground font-medium">{s.availability_window}</span></span>
                   </div>
                 </div>
               </div>
            </motion.div>
          ))}
        </div>
      )}

      {selectedPerson && (
        <CastInfoDialog
          personName={selectedPerson.name}
          reason={selectedPerson.reason}
          open={!!selectedPerson}
          onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}
          projectContext={projectContext}
        />
      )}
    </motion.div>
  );
}
