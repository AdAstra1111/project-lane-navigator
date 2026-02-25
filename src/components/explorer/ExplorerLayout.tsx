import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeft, LogOut, Plus, Settings, ArrowLeft } from 'lucide-react';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ModeToggle } from '@/components/ModeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { ExplorerSidebar } from './ExplorerSidebar';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export interface BreadcrumbSegment {
  label: string;
  to?: string;
}

interface ExplorerLayoutProps {
  breadcrumbs: BreadcrumbSegment[];
  children: React.ReactNode;
  /** Optional title override for the page area */
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function ExplorerLayout({ breadcrumbs, children, title, subtitle, actions }: ExplorerLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 h-12 border-b border-border/20 bg-background/80 backdrop-blur-2xl flex items-center px-3 gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Link to="/" className="flex items-center gap-2 shrink-0 group mr-2">
          <img src={iffyLogo} alt="IFFY" className="h-7 w-7 rounded-md ring-1 ring-border/30 group-hover:ring-primary/40 transition-all" />
          <span className="font-display font-semibold text-sm tracking-tight text-foreground hidden sm:inline">IFFY</span>
        </Link>

        <div className="h-4 w-px bg-border/40 mr-1" />

        {/* Breadcrumbs */}
        <Breadcrumb className="flex-1 min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((seg, i) => (
              <BreadcrumbItem key={i} className="min-w-0">
                {i > 0 && <BreadcrumbSeparator className="mx-1" />}
                {seg.to && i < breadcrumbs.length - 1 ? (
                  <BreadcrumbLink asChild>
                    <Link to={seg.to} className="text-xs truncate max-w-[140px]">{seg.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="text-xs truncate max-w-[180px] font-medium">{seg.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center gap-1.5 shrink-0">
          <ModeToggle />
          <GlobalSearch />
          <ThemeToggle />
          <NotificationBell />
          <Link to="/projects/new">
            <Button variant="outline" size="sm" className="h-7 text-[11px] border-border/30">
              <Plus className="h-3 w-3 mr-1" />
              New
            </Button>
          </Link>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => signOut()}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            'border-r border-sidebar-border bg-sidebar-background transition-all duration-200 shrink-0 overflow-hidden',
            sidebarOpen ? 'w-60' : 'w-0',
          )}
        >
          {sidebarOpen && <ExplorerSidebar />}
        </aside>

        {/* Main pane */}
        <main className="flex-1 overflow-y-auto">
          {(title || actions) && (
            <div className="border-b border-border/20 bg-background/50 px-6 py-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  {title && (
                    <h1 className="text-xl font-display font-bold text-foreground tracking-tight">{title}</h1>
                  )}
                  {subtitle && (
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
                  )}
                </div>
                {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
              </div>
            </div>
          )}
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
