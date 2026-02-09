import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Plus, Radio, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export function Header() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <span className="font-display font-bold text-sm text-primary-foreground">IF</span>
          </div>
          <span className="font-display font-semibold text-lg tracking-tight text-foreground">IFFY</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/trends')}
            className="text-muted-foreground hover:text-foreground"
          >
            <Radio className="h-4 w-4 mr-1" />
            Trends
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/incentives')}
            className="text-muted-foreground hover:text-foreground"
          >
            <Landmark className="h-4 w-4 mr-1" />
            Incentives
          </Button>
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
      </div>
    </header>
  );
}
