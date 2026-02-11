import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Film, Users, Handshake, FileText, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface SearchResult {
  id: string;
  type: 'project' | 'buyer' | 'deal' | 'contact';
  title: string;
  subtitle: string;
  link: string;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  project: Film,
  buyer: Users,
  deal: Handshake,
  contact: Users,
};

const TYPE_COLORS: Record<string, string> = {
  project: 'text-primary',
  buyer: 'text-emerald-400',
  deal: 'text-violet-400',
  contact: 'text-sky-400',
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Search
  useEffect(() => {
    if (!query.trim() || !user) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const q = query.trim().toLowerCase();
      const items: SearchResult[] = [];

      // Projects
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title, format, assigned_lane')
        .ilike('title', `%${q}%`)
        .limit(5);
      (projects || []).forEach(p => {
        items.push({
          id: p.id, type: 'project', title: p.title,
          subtitle: `${p.format} · ${p.assigned_lane || 'Unclassified'}`,
          link: `/projects/${p.id}`,
        });
      });

      // Buyer contacts
      const { data: contacts } = await supabase
        .from('buyer_contacts')
        .select('id, buyer_name, company, company_type')
        .or(`buyer_name.ilike.%${q}%,company.ilike.%${q}%`)
        .limit(5);
      (contacts || []).forEach(c => {
        items.push({
          id: c.id, type: 'contact', title: c.buyer_name || c.company,
          subtitle: `${c.company_type} · ${c.company}`,
          link: '/buyer-crm',
        });
      });

      // Market buyers
      const { data: buyers } = await supabase
        .from('market_buyers')
        .select('id, name, company_type')
        .ilike('name', `%${q}%`)
        .limit(5);
      (buyers || []).forEach(b => {
        items.push({
          id: b.id, type: 'buyer', title: b.name,
          subtitle: b.company_type,
          link: '/buyer-crm',
        });
      });

      // Deals
      const { data: deals } = await supabase
        .from('project_deals')
        .select('id, buyer_name, territory, project_id')
        .or(`buyer_name.ilike.%${q}%,territory.ilike.%${q}%`)
        .limit(5);
      (deals || []).forEach(d => {
        items.push({
          id: d.id, type: 'deal', title: d.buyer_name || 'Deal',
          subtitle: d.territory || '',
          link: `/projects/${d.project_id}`,
        });
      });

      setResults(items);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, user]);

  const handleSelect = (r: SearchResult) => {
    navigate(r.link);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-96 max-w-[90vw] rounded-xl border border-border bg-background shadow-xl z-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search projects, buyers, deals…"
              className="border-0 focus-visible:ring-0 h-10 text-sm"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="py-6 text-center">
                <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
              </div>
            )}
            {!loading && query && results.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">No results found</div>
            )}
            {!loading && results.map(r => {
              const Icon = TYPE_ICONS[r.type] || FileText;
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => handleSelect(r)}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors"
                >
                  <Icon className={cn('h-4 w-4 shrink-0', TYPE_COLORS[r.type])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{r.subtitle}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{r.type}</Badge>
                </button>
              );
            })}
            {!query && !loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type to search across all your data
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
