/**
 * CanonFactsManager — View, add, edit, delete, lock/unlock canon facts.
 */
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Plus, Trash2, Lock, Unlock, ArrowUpFromLine, Pencil, Check, X,
  Loader2, Info, ShieldCheck, BookOpen, Filter,
} from 'lucide-react';
import { useCanonFacts } from '@/hooks/useCanonFacts';
import { CATEGORY_LABELS, type CanonFact, type CanonCategory } from '@/lib/canon/normalizeCanonFacts';

interface Props {
  projectId: string;
}

const ALL_CATEGORIES: CanonCategory[] = [
  'logline', 'premise', 'character', 'world_rule', 'timeline',
  'location', 'tone_style', 'format_constraint', 'ongoing_thread',
  'forbidden_change',
];

const SOURCE_COLORS: Record<string, string> = {
  canon_editor: 'bg-primary/10 text-primary border-primary/30',
  locked_facts: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  doc_set: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const STATUS_COLORS: Record<string, string> = {
  accepted: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  locked: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  suggested: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
};

function FactRow({ fact, onEdit, onDelete, onLock, onUnlock, onPromote }: {
  fact: CanonFact;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onLock: (id: string) => void;
  onUnlock: (id: string) => void;
  onPromote: (fact: CanonFact) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(fact.text);
  const isEditable = fact.source === 'canon_editor';
  const isDeletable = fact.source === 'canon_editor';
  const isPromotable = fact.source !== 'canon_editor';
  const isLockable = fact.category !== 'forbidden_change' && fact.status !== 'locked';
  const isUnlockable = fact.category === 'forbidden_change';

  const handleSave = () => {
    onEdit(fact.id, editText);
    setEditing(false);
  };

  return (
    <div className="flex items-start gap-2 p-2 rounded-md border border-border/40 bg-card/50 hover:bg-muted/20 transition-colors group">
      <Badge variant="outline" className="text-[8px] px-1.5 py-0 mt-0.5 shrink-0 border-border">
        {CATEGORY_LABELS[fact.category]}
      </Badge>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="h-6 text-[11px] flex-1"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
            />
            <button onClick={handleSave} className="p-0.5 text-primary hover:text-primary/80">
              <Check className="h-3 w-3" />
            </button>
            <button onClick={() => setEditing(false)} className="p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-foreground leading-snug">{fact.text}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant="outline" className={`text-[7px] px-1 py-0 ${STATUS_COLORS[fact.status]}`}>
            {fact.status}
          </Badge>
          <Badge variant="outline" className={`text-[7px] px-1 py-0 ${SOURCE_COLORS[fact.source]}`}>
            {fact.source.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {isEditable && !editing && (
          <button onClick={() => { setEditText(fact.text); setEditing(true); }}
            className="p-1 rounded text-muted-foreground hover:text-foreground" title="Edit">
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {isLockable && (
          <button onClick={() => onLock(fact.id)}
            className="p-1 rounded text-muted-foreground hover:text-amber-500" title="Lock">
            <Lock className="h-3 w-3" />
          </button>
        )}
        {isUnlockable && (
          <button onClick={() => onUnlock(fact.id)}
            className="p-1 rounded text-amber-500 hover:text-foreground" title="Unlock">
            <Unlock className="h-3 w-3" />
          </button>
        )}
        {isPromotable && (
          <button onClick={() => onPromote(fact)}
            className="p-1 rounded text-muted-foreground hover:text-primary" title="Promote to Canon Editor">
            <ArrowUpFromLine className="h-3 w-3" />
          </button>
        )}
        {isDeletable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="p-1 rounded text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 className="h-3 w-3" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-sm">Delete canon fact?</AlertDialogTitle>
                <AlertDialogDescription className="text-xs">
                  This will remove "{fact.text.slice(0, 80)}…" from the Canon Editor. Engines will no longer enforce it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(fact.id)} className="text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

export function CanonFactsManager({ projectId }: Props) {
  const {
    facts, source, sourceLabel, evidence,
    isLoading, isSaving,
    addFact, updateFact, deleteFact, lockFact, unlockFact, promoteFact,
  } = useCanonFacts(projectId);

  const [filter, setFilter] = useState<CanonCategory | 'all'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<CanonCategory>('logline');
  const [newText, setNewText] = useState('');

  const filteredFacts = filter === 'all' ? facts : facts.filter(f => f.category === filter);

  const handleAdd = useCallback(async () => {
    if (!newText.trim()) return;
    await addFact(newCategory, newText.trim());
    setNewText('');
    setShowAddForm(false);
  }, [newCategory, newText, addFact]);

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground p-4 flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading canon facts…
      </div>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="py-2.5 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Canon Facts
            {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[8px] px-1.5 py-0 ${SOURCE_COLORS[source]}`}>
              {sourceLabel}
            </Badge>
            <Badge variant="outline" className="text-[8px] px-1.5 py-0">
              {facts.length} fact{facts.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-2.5 pb-2.5 space-y-2">
        {/* Evidence */}
        {evidence && (
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground px-1">
            <Info className="h-2.5 w-2.5 shrink-0" />
            {evidence.canon_editor_populated && (
              <span>Editor fields: {evidence.canon_editor_fields.join(', ')}</span>
            )}
            {evidence.locked_decision_count > 0 && (
              <span>· {evidence.locked_decision_count} locked decision{evidence.locked_decision_count !== 1 ? 's' : ''}</span>
            )}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-1.5">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="h-6 text-[10px] w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {ALL_CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="h-3 w-3" /> Add Fact
          </Button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="flex items-center gap-1.5 p-2 rounded border border-primary/20 bg-primary/5">
            <Select value={newCategory} onValueChange={(v) => setNewCategory(v as CanonCategory)}>
              <SelectTrigger className="h-6 text-[10px] w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Enter fact text…"
              className="h-6 text-[11px] flex-1"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
            <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleAdd} disabled={!newText.trim()}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => setShowAddForm(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        <Separator />

        {/* Facts list */}
        {filteredFacts.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <BookOpen className="h-5 w-5 mx-auto text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              {facts.length === 0
                ? 'No canon facts established yet.'
                : 'No facts match the selected filter.'}
            </p>
            {facts.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-3 w-3" /> Add your first canon fact
              </Button>
            )}
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1">
              {filteredFacts.map(fact => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  onEdit={updateFact}
                  onDelete={deleteFact}
                  onLock={lockFact}
                  onUnlock={unlockFact}
                  onPromote={promoteFact}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Source warning */}
        {source === 'unknown' && (
          <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-destructive/5 border border-destructive/20 text-[10px]">
            <Info className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              No canonical state. Engines will not assert facts. Add facts above or fill the Canon Editor.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
