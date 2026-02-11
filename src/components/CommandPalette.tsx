import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Plus, Kanban, ArrowLeftRight, Search, TrendingUp, 
  Landmark, Globe, Calendar, Users, BarChart3, Settings, Building2,
  Film, Handshake, FileText, Bell, BookOpen, HelpCircle, Info
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
  { label: 'Notifications', icon: Bell, path: '/notifications', keywords: 'alerts updates', group: 'navigate' },
  { label: 'Settings', icon: Settings, path: '/settings', keywords: 'profile account', group: 'navigate' },
  { label: 'New Project', icon: Plus, path: '/projects/new', keywords: 'create add', group: 'create' },
  { label: 'How It Works', icon: BookOpen, path: '/how-it-works', keywords: 'guide tutorial', group: 'tools' },
  { label: 'FAQ', icon: HelpCircle, path: '/faq', keywords: 'help questions', group: 'tools' },
  { label: 'About IFFY', icon: Info, path: '/about', keywords: 'what is', group: 'tools' },
];

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [projectResults, setProjectResults] = useState<SearchResult[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Search projects when query changes
  useEffect(() => {
    if (!search.trim() || !user) { setProjectResults([]); return; }
    const timeout = setTimeout(async () => {
      const q = search.trim().toLowerCase();
      const { data } = await supabase
        .from('projects')
        .select('id, title, format, assigned_lane')
        .ilike('title', `%${q}%`)
        .limit(6);
      setProjectResults(
        (data || []).map(p => ({
          id: p.id,
          title: p.title,
          subtitle: `${p.format === 'tv-series' ? 'TV Series' : 'Film'} · ${p.assigned_lane || 'Unclassified'}`,
          path: `/projects/${p.id}`,
        }))
      );
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
        placeholder="Where do you want to go?" 
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Project results */}
        {projectResults.length > 0 && (
          <CommandGroup heading="Projects">
            {projectResults.map(p => (
              <CommandItem key={p.id} onSelect={() => handleSelect(p.path)}>
                <Film className="mr-2 h-4 w-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{p.title}</span>
                  <span className="text-xs text-muted-foreground ml-2">{p.subtitle}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectResults.length > 0 && <CommandSeparator />}

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
