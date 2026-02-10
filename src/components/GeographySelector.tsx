import { useState } from 'react';
import { MapPin, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const COMMON_TERRITORIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'France',
  'Germany', 'Italy', 'Spain', 'Ireland', 'New Zealand',
  'South Africa', 'Hungary', 'Czech Republic', 'Romania', 'Colombia',
  'South Korea', 'India', 'Mexico', 'Belgium', 'Netherlands',
  'Norway', 'Sweden', 'Denmark', 'Iceland', 'Luxembourg',
  'Portugal', 'Greece', 'Poland', 'Croatia', 'Morocco',
  'Georgia', 'Malta', 'Serbia', 'Jordan', 'Thailand',
];

interface GeographySelectorProps {
  projectId: string;
  primaryTerritory: string;
  secondaryTerritories: string[];
}

export function GeographySelector({ projectId, primaryTerritory, secondaryTerritories }: GeographySelectorProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [addingSecondary, setAddingSecondary] = useState(false);

  const updateTerritory = async (field: 'primary_territory' | 'secondary_territories', value: string | string[]) => {
    setSaving(true);
    const { error } = await supabase
      .from('projects')
      .update({ [field]: value })
      .eq('id', projectId);
    setSaving(false);
    if (error) {
      toast.error('Failed to update territory');
    } else {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    }
  };

  const addSecondary = (territory: string) => {
    if (!territory || secondaryTerritories.includes(territory)) return;
    updateTerritory('secondary_territories', [...secondaryTerritories, territory]);
    setAddingSecondary(false);
  };

  const removeSecondary = (territory: string) => {
    updateTerritory('secondary_territories', secondaryTerritories.filter(t => t !== territory));
  };

  const availableTerritories = COMMON_TERRITORIES.filter(
    t => t !== primaryTerritory && !secondaryTerritories.includes(t)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span className="text-sm font-medium text-foreground">Production Geography</span>
      </div>

      {/* Primary Territory */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Primary Territory</p>
        <Select
          value={primaryTerritory || '_none'}
          onValueChange={(v) => updateTerritory('primary_territory', v === '_none' ? '' : v)}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select primary territory" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Not set</SelectItem>
            {COMMON_TERRITORIES.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Secondary Territories */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Secondary Territories</p>
        <div className="flex flex-wrap gap-1.5">
          {secondaryTerritories.map(t => (
            <Badge key={t} variant="secondary" className="text-xs gap-1 pr-1">
              {t}
              <button onClick={() => removeSecondary(t)} className="hover:text-destructive transition-colors">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {addingSecondary ? (
            <Select onValueChange={addSecondary}>
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue placeholder="Choose territory" />
              </SelectTrigger>
              <SelectContent>
                {availableTerritories.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-primary px-2"
              onClick={() => setAddingSecondary(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
