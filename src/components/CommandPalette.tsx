import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Plus, Kanban, ArrowLeftRight, Search, TrendingUp, 
  Landmark, Globe, Calendar, Users, BarChart3, Settings, Building2,
  Film, Handshake, FileText, Bell, BookOpen, HelpCircle, Info, Loader2,
  FlaskConical, Lightbulb
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface QuickAction {
  label: string;
  icon: React.ElementType;
  path: string;
  keywords?: string;
  group: 'navigate' | 'create' | 'tools';
}

const ACTIONS: QuickAction[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', keywords: 'home projects slate', group: 'navigate' },
  { label: 'Pipeline Board', icon: Kanban, path: '/pipeline', keywords: 'kanban stages', group: 'navigate' },
  { label: 'Compare Projects', icon: ArrowLeftRight, path: '/compare', keywords: 'side by side', group: 'navigate' },
  { label: 'Market Intelligence', icon: Globe, path: '/market-intelligence', keywords: 'territory buyers market', group: 'navigate' },
  { label: 'Cast & Story Trends', icon: TrendingUp, path: '/trends', keywords: 'actors talent signals', group: 'navigate' },
  { label: 'Incentive Finder', icon: Landmark, path: '/incentives', keywords: 'tax credit rebate', group: 'navigate' },
  { label: 'Co-Production Planner', icon: Globe, path: '/incentives/copro', keywords: 'treaty international', group: 'navigate' },
  { label: 'Festival Calendar', icon: Calendar, path: '/festivals', keywords: 'cannes berlin sundance markets', group: 'navigate' },
  { label: 'Production Calendar', icon: Calendar, path: '/calendar', keywords: 'schedule dates', group: 'navigate' },
  { label: 'Buyer CRM', icon: Users, path: '/buyer-crm', keywords: 'contacts meetings', group: 'navigate' },
  { label: 'Reports', icon: BarChart3, path: '/reports', keywords: 'export pdf analytics', group: 'navigate' },
  { label: 'Companies', icon: Building2, path: '/companies', keywords: 'production entities', group: 'navigate' },
  { label: 'Pitch Ideas', icon: Lightbulb, path: '/pitch-ideas', keywords: 'concepts pitches', group: 'navigate' },
  { label: 'Coverage Lab', icon: FlaskConical, path: '/coverage-lab', keywords: 'script analysis', group: 'navigate' },
  { label: 'Calibration Lab', icon: BarChart3, path: '/calibration-lab', keywords: 'accuracy outcomes', group: 'navigate' },
  { label: 'Notifications', icon: Bell, path: '/notifications', keywords: 'alerts updates', group: 'navigate' },
  { label: 'Settings', icon: Settings, path: '/settings', keywords: 'profile account', group: 'navigate' },
  { label: 'New Project', icon: Plus, path: '/projects/new', keywords: 'create add', group: 'create' },
  { label: 'How It Works', icon: BookOpen, path: '/how-it-works', keywords: 'guide tutorial', group: 'tools' },
  { label: 'FAQ', icon: HelpCircle, path: '/faq', keywords: 'help questions', group: 'tools' },
  { label: 'About IFFY', icon: Info, path: '/about', keywords: 'what is', group: 'tools' },
];

interface SearchResult {
  id: string;
  type: 'project' | 'buyer' | 'deal' | 'contact';
  title: string;
  subtitle: string;
  path: string;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  project: Film,
  buyer: Users,
  deal: Handshake,
  contact: Users,
};

const TYPE_LABELS: Record<string, string> = {
  project: 'Project',
  buyer: 'Buyer',
  deal: 'Deal',
  contact: 'Contact',
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  // Listen for both keyboard shortcut and custom event from trigger button
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener('keydown', down);
    window.addEventListener('open-command-palette', openHandler);
    return () => {
      document.removeEventListener('keydown', down);
      window.removeEventListener('open-command-palette', openHandler);
    };
  }, []);

  // Multi-entity search when query changes
  useEffect(() => {
    if (!search.trim() || !user) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const q = search.trim().toLowerCase();
      const items: SearchResult[] = [];

      // Projects
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title, format, assigned_lane')
        .ilike('title', `%${q}%`)
        .limit(6);
      (projects || []).forEach(p => {
        items.push({
          id: p.id, type: 'project', title: p.title,
          subtitle: `${p.format === 'tv-series' ? 'TV Series' : 'Film'} · ${p.assigned_lane || 'Unclassified'}`,
          path: `/projects/${p.id}`,
        });
      });

      // Buyer contacts
      const { data: contacts } = await supabase
        .from('buyer_contacts')
        .select('id, buyer_name, company, company_type')
        .or(`buyer_name.ilike.%${q}%,company.ilike.%${q}%`)
        .limit(4);
      (contacts || []).forEach(c => {
        items.push({
          id: c.id, type: 'contact', title: c.buyer_name || c.company,
          subtitle: `${c.company_type} · ${c.company}`,
          path: '/buyer-crm',
        });
      });

      // Deals
      const { data: deals } = await supabase
        .from('project_deals')
        .select('id, buyer_name, territory, project_id')
        .or(`buyer_name.ilike.%${q}%,territory.ilike.%${q}%`)
        .limit(4);
      (deals || []).forEach(d => {
        items.push({
          id: d.id, type: 'deal', title: d.buyer_name || 'Deal',
          subtitle: d.territory || '',
          path: `/projects/${d.project_id}`,
        });
      });

      setResults(items);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timeout);
  }, [search, user]);

  const handleSelect = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
    setSearch('');
  }, [navigate]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput 
        placeholder="Search projects, buyers, or navigate…" 
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Searching…</span>
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {/* Multi-entity results */}
        {results.length > 0 && (
          <CommandGroup heading="Results">
            {results.map(r => {
              const Icon = TYPE_ICONS[r.type] || FileText;
              return (
                <CommandItem key={`${r.type}-${r.id}`} onSelect={() => handleSelect(r.path)}>
                  <Icon className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">{r.title}</span>
                    <span className="text-xs text-muted-foreground ml-2">{r.subtitle}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] ml-2 shrink-0">{TYPE_LABELS[r.type]}</Badge>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {results.length > 0 && <CommandSeparator />}

        <CommandGroup heading="Navigation">
          {ACTIONS.filter(a => a.group === 'navigate').map(a => {
            const Icon = a.icon;
            return (
              <CommandItem key={a.path} onSelect={() => handleSelect(a.path)} keywords={[a.keywords || '']}>
                <Icon className="mr-2 h-4 w-4" />
                <span>{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {ACTIONS.filter(a => a.group === 'create').map(a => {
            const Icon = a.icon;
            return (
              <CommandItem key={a.path} onSelect={() => handleSelect(a.path)} keywords={[a.keywords || '']}>
                <Icon className="mr-2 h-4 w-4" />
                <span>{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          {ACTIONS.filter(a => a.group === 'tools').map(a => {
            const Icon = a.icon;
            return (
              <CommandItem key={a.path} onSelect={() => handleSelect(a.path)} keywords={[a.keywords || '']}>
                <Icon className="mr-2 h-4 w-4" />
                <span>{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
