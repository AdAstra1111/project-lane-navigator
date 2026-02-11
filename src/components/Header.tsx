import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Plus, Radio, Landmark, HelpCircle, ChevronDown, Calendar, Users, LayoutGrid, Globe, BarChart3, Settings, Menu, X, Building2, GraduationCap } from 'lucide-react';
import iffyLogo from '@/assets/iffy-logo-v3.png';
import { NotificationBell } from '@/components/NotificationBell';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { GuidedTutorial } from '@/components/GuidedTutorial';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

export function Header() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const navItems = [
    { label: 'Companies', icon: Building2, path: '/companies' },
    { label: 'Trends', icon: Radio, path: '/trends' },
    { label: 'Incentives', icon: Landmark, path: '/incentives' },
    { label: 'Calendar', icon: LayoutGrid, path: '/calendar' },
    { label: 'Buyers', icon: Users, path: '/buyer-crm' },
    { label: 'Intel', icon: Globe, path: '/market-intelligence' },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src={iffyLogo} alt="IFFY logo" className="h-8 w-8 rounded-md" />
          <div className="flex flex-col leading-none">
            <span className="font-display font-semibold text-lg tracking-tight text-foreground">IFFY</span>
            <span className="text-[10px] text-muted-foreground tracking-widest uppercase">Intelligent Film Flow & Yield</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-3">
          {navItems.map(item => (
            <Button
              key={item.path}
              variant="ghost"
              size="sm"
              onClick={() => navigate(item.path)}
              className="text-muted-foreground hover:text-foreground"
            >
              <item.icon className="h-4 w-4 mr-1" />
              {item.label}
            </Button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <HelpCircle className="h-4 w-4 mr-1" />
                More
                <ChevronDown className="h-3 w-3 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => navigate('/reports')}>
                <BarChart3 className="h-4 w-4 mr-2" /> Reports & Exports
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/festivals')}>
                <Calendar className="h-4 w-4 mr-2" /> Festivals
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowTutorial(true)}>
                <GraduationCap className="h-4 w-4 mr-2" /> Tutorial
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/about')}>About IFFY</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/how-it-works')}>How It Works</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/faq')}>FAQ</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="h-4 w-4 mr-2" /> Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <GlobalSearch />
          <ThemeToggle />
          <NotificationBell />
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/projects/new')}
            className="border-border/50 hover:border-primary/50 hover:bg-primary/5"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Project
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {/* Mobile controls */}
        <div className="flex md:hidden items-center gap-2">
          <GlobalSearch />
          <ThemeToggle />
          <NotificationBell />
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background p-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setMobileOpen(false); }}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
          <div className="border-t border-border/30 my-2" />
          {[
            { label: 'Reports & Exports', path: '/reports', icon: BarChart3 },
            { label: 'Festivals', path: '/festivals', icon: Calendar },
            { label: 'Settings', path: '/settings', icon: Settings },
          ].map(item => (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setMobileOpen(false); }}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
          <div className="border-t border-border/30 my-2" />
          <button
            onClick={() => { navigate('/projects/new'); setMobileOpen(false); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
          <button
            onClick={() => { handleSignOut(); setMobileOpen(false); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      )}

      {showTutorial && (
        <GuidedTutorial onClose={() => setShowTutorial(false)} />
      )}
    </header>
  );
}
