import { Link } from 'react-router-dom';
import { Film, Presentation, ArrowLeft } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';

const SHOWCASE_ITEMS = [
  { label: 'Guided Demo', path: '/demo', description: 'Step-by-step product walkthrough' },
  { label: 'Cinematic Demo', path: '/demo/cinematic', description: 'High-fidelity cinematic experience' },
  { label: 'Interactive Demo', path: '/demo/interactive', description: 'Hands-on interactive exploration' },
  { label: 'Executive Mode', path: '/demo/executive', description: 'Executive-level overview' },
  { label: 'Investor Presentation', path: '/investor', description: 'Investor-ready presentation deck' },
  { label: 'Demo Dashboard', path: '/demo/run', description: 'One-click pipeline demo with live orchestration' },
];

export default function Showcase() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-16 px-6">
        <div className="mb-8">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
          </Link>
          <h1 className="text-2xl font-display font-semibold text-foreground tracking-tight">Showcase</h1>
          <p className="text-sm text-muted-foreground mt-1">Demos and presentations</p>
        </div>
        <div className="space-y-3">
          {SHOWCASE_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center gap-4 rounded-xl border border-border/50 bg-card/40 p-5 hover:border-primary/30 hover:bg-card/60 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Film className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
