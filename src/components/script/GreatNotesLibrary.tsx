import { useState, useEffect } from 'react';
import { BookOpen, Search, Trash2, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format as fmtDate } from 'date-fns';

const PROBLEM_TYPES = [
  'all', 'structure', 'character', 'dialogue', 'theme', 'market', 'pacing', 'stakes', 'tone', 'general',
];

const PROJECT_TYPES = [
  'all', 'Feature Film', 'TV Series', 'Documentary Feature', 'Documentary Series',
  'Short Film', 'Digital / Social Series', 'Vertical Drama', 'Commercial / Advert',
];

interface GreatNote {
  id: string;
  project_type: string;
  problem_type: string;
  genre: string | null;
  note_text: string;
  tags: string[];
  evidence_style: string | null;
  created_at: string;
}

export function GreatNotesLibrary() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<GreatNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterProblem, setFilterProblem] = useState('all');
  const [filterProject, setFilterProject] = useState('all');

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('great_notes_library')
      .select('id, project_type, problem_type, genre, note_text, tags, evidence_style, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    setNotes((data as any[]) || []);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('great_notes_library').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete note');
    } else {
      setNotes(prev => prev.filter(n => n.id !== id));
      toast.success('Note removed from library');
    }
  };

  const filtered = notes.filter(n => {
    if (filterProblem !== 'all' && n.problem_type !== filterProblem) return false;
    if (filterProject !== 'all' && n.project_type !== filterProject) return false;
    if (search && !n.note_text.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const PROBLEM_COLORS: Record<string, string> = {
    structure: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    character: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    dialogue: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    theme: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    market: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    pacing: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    stakes: 'bg-red-500/15 text-red-400 border-red-500/30',
    tone: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    general: 'bg-muted/30 text-muted-foreground border-border/50',
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={filterProblem} onValueChange={setFilterProblem}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROBLEM_TYPES.map(pt => (
              <SelectItem key={pt} value={pt} className="text-xs capitalize">{pt === 'all' ? 'All Problems' : pt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_TYPES.map(pt => (
              <SelectItem key={pt} value={pt} className="text-xs">{pt === 'all' ? 'All Project Types' : pt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground">{filtered.length} notes</span>
      </div>

      {/* Notes list */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <BookOpen className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No great notes yet</p>
          <p className="text-xs text-muted-foreground/70">Tag coverage notes as ✅ Great to build your library</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {filtered.map(note => (
            <div key={note.id} className="group p-3 rounded-lg border border-border/40 bg-card/50 hover:bg-muted/20 transition-colors">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <p className="text-sm text-foreground leading-relaxed">{note.note_text}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PROBLEM_COLORS[note.problem_type] || PROBLEM_COLORS.general}`}>
                      {note.problem_type}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">
                      {note.project_type}
                    </span>
                    {note.genre && (
                      <span className="text-[10px] text-muted-foreground/70">{note.genre}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50">
                      {fmtDate(new Date(note.created_at), 'dd MMM yyyy')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
                  title="Remove from library"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
