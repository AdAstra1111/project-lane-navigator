import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, DollarSign, Landmark, Scale, Palette, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

interface RoleDashboardProps {
  projects: Project[];
  role: 'producer' | 'sales_agent' | 'lawyer' | 'creative';
}

const ROLE_CONFIG = {
  producer: {
    label: 'Producer View',
    icon: Users,
    description: 'Packaging progress, financing gaps, and deadline tracking',
    color: 'text-primary',
  },
  sales_agent: {
    label: 'Sales Agent View',
    icon: DollarSign,
    description: 'Market-ready projects, buyer alignment, and territory coverage',
    color: 'text-emerald-400',
  },
  lawyer: {
    label: 'Legal View',
    icon: Scale,
    description: 'Chain of title status, co-production compliance, and deal structure',
    color: 'text-amber-400',
  },
  creative: {
    label: 'Creative View',
    icon: Palette,
    description: 'Script status, cast attachments, and creative direction',
    color: 'text-purple-400',
  },
};

function ProducerView({ projects }: { projects: Project[] }) {
  const stats = useMemo(() => {
    const byStage = projects.reduce((acc, p) => {
      acc[p.pipeline_stage] = (acc[p.pipeline_stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const needsAttention = projects.filter(p => {
      const daysSinceUpdate = Math.floor((Date.now() - new Date(p.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceUpdate > 14;
    });

    return { byStage, needsAttention };
  }, [projects]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['development', 'packaging', 'financing', 'pre-production'].map(stage => (
          <div key={stage} className="glass-card rounded-lg p-3 text-center">
            <p className="text-2xl font-display font-bold text-foreground">{stats.byStage[stage] || 0}</p>
            <p className="text-xs text-muted-foreground capitalize">{stage.replace('-', ' ')}</p>
          </div>
        ))}
      </div>
      {stats.needsAttention.length > 0 && (
        <div className="glass-card rounded-lg p-3">
          <p className="text-xs text-amber-400 font-medium mb-2">Needs Attention ({stats.needsAttention.length})</p>
          {stats.needsAttention.slice(0, 3).map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors">
              <span className="text-foreground">{p.title}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SalesView({ projects }: { projects: Project[] }) {
  const marketReady = projects.filter(p => p.pipeline_stage === 'financing' || p.pipeline_stage === 'pre-production');
  const byLane = projects.reduce((acc, p) => {
    if (p.assigned_lane) acc[p.assigned_lane] = (acc[p.assigned_lane] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-lg p-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Market-Ready Projects</p>
        <p className="text-2xl font-display font-bold text-foreground">{marketReady.length}</p>
        <p className="text-xs text-muted-foreground">of {projects.length} total</p>
      </div>
      {marketReady.length > 0 && (
        <div className="glass-card rounded-lg p-3 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Ready for Market</p>
          {marketReady.slice(0, 5).map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between py-1 text-sm hover:text-primary transition-colors">
              <span className="text-foreground">{p.title}</span>
              <Badge variant="secondary" className="text-[10px]">{p.genres?.[0]}</Badge>
            </Link>
          ))}
        </div>
      )}
      <div className="glass-card rounded-lg p-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Lane Distribution</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byLane).map(([lane, count]) => (
            <Badge key={lane} variant="outline" className="text-xs">
              {lane.replace(/-/g, ' ')} ({count})
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function LawyerView({ projects }: { projects: Project[] }) {
  const coproProjects = projects.filter(p => p.assigned_lane === 'international-copro');
  const inFinancing = projects.filter(p => p.pipeline_stage === 'financing');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-lg p-3 text-center">
          <p className="text-2xl font-display font-bold text-foreground">{coproProjects.length}</p>
          <p className="text-xs text-muted-foreground">Co-Productions</p>
        </div>
        <div className="glass-card rounded-lg p-3 text-center">
          <p className="text-2xl font-display font-bold text-foreground">{inFinancing.length}</p>
          <p className="text-xs text-muted-foreground">In Financing</p>
        </div>
      </div>
      <div className="glass-card rounded-lg p-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Projects Needing Legal Review</p>
        {[...coproProjects, ...inFinancing].slice(0, 5).map(p => (
          <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors">
            <span className="text-foreground">{p.title}</span>
            <Badge variant="outline" className="text-[10px] capitalize">{p.pipeline_stage}</Badge>
          </Link>
        ))}
        {coproProjects.length === 0 && inFinancing.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No projects currently need legal review</p>
        )}
      </div>
    </div>
  );
}

function CreativeView({ projects }: { projects: Project[] }) {
  const inDev = projects.filter(p => p.pipeline_stage === 'development');
  const byGenre = projects.reduce((acc, p) => {
    (p.genres || []).forEach(g => { acc[g] = (acc[g] || 0) + 1; });
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-lg p-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">In Development</p>
        <p className="text-2xl font-display font-bold text-foreground">{inDev.length}</p>
      </div>
      <div className="glass-card rounded-lg p-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Genre Spread</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byGenre).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([genre, count]) => (
            <Badge key={genre} variant="outline" className="text-xs">
              {genre} ({count})
            </Badge>
          ))}
        </div>
      </div>
      {inDev.length > 0 && (
        <div className="glass-card rounded-lg p-3 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Active Development</p>
          {inDev.slice(0, 5).map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between py-1 text-sm hover:text-primary transition-colors">
              <span className="text-foreground">{p.title}</span>
              <span className="text-xs text-muted-foreground">{p.genres?.join(', ')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const VIEW_COMPONENTS: Record<string, React.FC<{ projects: Project[] }>> = {
  producer: ProducerView,
  sales_agent: SalesView,
  lawyer: LawyerView,
  creative: CreativeView,
};

export function RoleDashboard({ projects, role }: RoleDashboardProps) {
  const config = ROLE_CONFIG[role];
  const ViewComponent = VIEW_COMPONENTS[role];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('h-4 w-4', config.color)} />
        <h2 className="font-display font-semibold text-foreground text-sm">{config.label}</h2>
        <span className="text-xs text-muted-foreground">— {config.description}</span>
      </div>
      <ViewComponent projects={projects} />
    </motion.div>
  );
}
