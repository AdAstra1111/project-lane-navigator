import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Users, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { CastInfoDialog } from '@/components/CastInfoDialog';
import { CharacterSelector } from '@/components/CharacterSelector';
import { TalentTriageBoard } from '@/components/TalentTriageBoard';
import { useTalentTriage } from '@/hooks/useTalentTriage';
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

export function SmartPackaging({ projectId, projectTitle, format, genres, budgetRange, tone, assignedLane, mode = 'cast', scriptCharacters = [], scriptCharactersLoading }: Props) {
  const [suggestions, setSuggestions] = useState<PackagingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; reason: string } | null>(null);
  const [targetCharacter, setTargetCharacter] = useState<ScriptCharacter | null>(null);
  const [targetDepartment, setTargetDepartment] = useState<string | null>(null);
  const [customBrief, setCustomBrief] = useState('');

  const triage = useTalentTriage(projectId);

  // Filter triage items by mode: cast tab sees cast items, crew tab sees crew/director items
  const isCastType = (type: string) => type === 'cast' || type === 'actor';
  const isCrewType = (type: string) => type === 'crew' || type === 'director' || type === 'hod';
  const modeFilter = mode === 'cast' ? isCastType : isCrewType;
  const filteredItems = triage.items.filter(i => modeFilter(i.person_type));
  const filteredByStatus = (status: string) =>
    filteredItems.filter(i => i.status === status).sort((a, b) => status === 'shortlist' ? a.priority_rank - b.priority_rank : 0);

  const projectContext = { title: projectTitle, format, budget_range: budgetRange, genres };

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('smart-packaging', {
        body: { projectTitle, format, genres, budgetRange, tone, assignedLane, mode, customBrief: customBrief.trim().slice(0, 500) || undefined, targetDepartment: mode === 'crew' ? targetDepartment : undefined, targetCharacter: (mode === 'cast' && targetCharacter) ? { name: targetCharacter.name, description: targetCharacter.description, scene_count: targetCharacter.scene_count } : undefined },
      });
      if (error) throw error;
      const results: PackagingSuggestion[] = data?.suggestions || [];
      setSuggestions(results);

      // Auto-save to triage (skip duplicates by name)
      const existingNames = new Set(triage.items.map(i => i.person_name.toLowerCase()));
      const newItems = results
        .filter(s => !existingNames.has(s.name.toLowerCase()))
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
        <Button size="sm" variant="outline" onClick={fetchSuggestions} disabled={loading || replacementLoading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
          {filteredItems.length > 0 ? 'Get More' : 'Get Suggestions'}
        </Button>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="h-3.5 w-3.5 text-amber-400" />
                    <button
                      onClick={() => setSelectedPerson({ name: s.name, reason: `${s.role} · ${s.rationale}` })}
                      className="font-semibold text-sm text-foreground hover:text-primary transition-colors cursor-pointer"
                    >
                      {s.name}
                    </button>
                    <span className="text-xs text-muted-foreground">· {s.role}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.rationale}</p>
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>Market Value: <span className="text-foreground font-medium">{s.market_value}</span></span>
                <span>Window: <span className="text-foreground font-medium">{s.availability_window}</span></span>
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
