import { useState } from 'react';
import { Package, Plus, Trash2, GripVertical, Users, Film, Megaphone, Briefcase } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePackagingItems } from '@/hooks/usePromotionModules';

const STATUS_ORDER = ['TARGET', 'OUTREACH', 'IN_DISCUSSION', 'ATTACHED', 'PASSED'] as const;
const STATUS_LABELS: Record<string, string> = {
  TARGET: 'Target', OUTREACH: 'Outreach', IN_DISCUSSION: 'In Discussion', ATTACHED: 'Attached', PASSED: 'Passed',
};
const STATUS_COLORS: Record<string, string> = {
  TARGET: 'bg-muted text-muted-foreground',
  OUTREACH: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  IN_DISCUSSION: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  ATTACHED: 'bg-green-500/15 text-green-400 border-green-500/30',
  PASSED: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const TYPE_ICONS: Record<string, any> = {
  CAST: Users, DIRECTOR: Film, WRITER: Film, PRODUCER: Briefcase, SALES: Megaphone, BRAND: Package,
};

interface Props { projectId: string; }

export function PackagingPipelinePanel({ projectId }: Props) {
  const { items, updateItem, addItem, deleteItem } = usePackagingItems(projectId);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_type: 'CAST', name: '', archetype: '' });

  const handleAdd = () => {
    addItem(newItem);
    setNewItem({ item_type: 'CAST', name: '', archetype: '' });
    setAddOpen(false);
  };

  const grouped = STATUS_ORDER.map(status => ({
    status,
    label: STATUS_LABELS[status],
    items: items.filter(i => i.status === status),
  }));

  return (
    <Card className="border-border/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" /> Packaging Pipeline
          </CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {grouped.map(group => (
          <div key={group.status}>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge className={`text-[10px] ${STATUS_COLORS[group.status]}`}>{group.label}</Badge>
              <span className="text-xs text-muted-foreground">({group.items.length})</span>
            </div>
            {group.items.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 pl-2 mb-2">No items</p>
            ) : (
              <div className="space-y-1 mb-2">
                {group.items.map(item => {
                  const Icon = TYPE_ICONS[item.item_type] || Package;
                  return (
                    <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30 hover:bg-muted/50 group text-sm">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-xs">{item.item_type}</span>
                      <span className="text-xs text-muted-foreground truncate flex-1">
                        {item.name || item.archetype}
                      </span>
                      <Select
                        value={item.status}
                        onValueChange={(val) => updateItem({ id: item.id, status: val })}
                      >
                        <SelectTrigger className="h-6 w-28 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_ORDER.map(s => (
                            <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => deleteItem(item.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Packaging Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={newItem.item_type} onValueChange={v => setNewItem(p => ({ ...p, item_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['CAST', 'DIRECTOR', 'WRITER', 'PRODUCER', 'SALES', 'CO-PRO', 'FINANCIER', 'BRAND'].map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Name (optional)" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} />
            <Textarea placeholder="Archetype description" value={newItem.archetype} onChange={e => setNewItem(p => ({ ...p, archetype: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
