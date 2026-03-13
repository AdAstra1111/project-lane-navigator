import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileUpload } from '@/components/FileUpload';
import { supabase } from '@/integrations/supabase/client';
import { createPendingUpload, MAX_PENDING_FILES, MAX_PENDING_FILE_SIZE } from '@/lib/pendingUploads';
import { toast } from 'sonner';
import { ArrowRight, Sparkles, ChevronDown } from 'lucide-react';
import { lazy, Suspense, Component, ReactNode } from 'react';

function TourLoader() {
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16">
        <button
          onClick={() => setLoaded(true)}
          className="px-8 py-3 rounded-full border border-primary/40 text-primary text-sm font-medium tracking-wide hover:bg-primary/10 transition-colors"
        >
          Load tour
        </button>
      </div>
    );
  }
  return (
    <TourErrorBoundary>
      <Suspense fallback={
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      }>
        <CinematicDemo />
      </Suspense>
    </TourErrorBoundary>
  );
}

class TourErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return (
      <div className="py-24 text-center text-muted-foreground/40 text-sm">
        <button
          onClick={() => this.setState({ error: false })}
          className="text-primary/60 hover:text-primary underline"
        >
          Load tour
        </button>
      </div>
    );
    return this.props.children;
  }
}
const CinematicDemo = lazy(() => import('@/components/landing/CinematicDemo'));

// ── Compatibility tool list ──
const COMPAT_TOOLS = [
  { category: 'Script', tools: ['Final Draft', 'Highland', 'Fade In', 'WriterDuet', 'Celtx', 'Arc Studio'] },
  { category: 'Scheduling', tools: ['Movie Magic Scheduling', 'StudioBinder', 'Gorilla Scheduling'] },
  { category: 'Budgeting', tools: ['Movie Magic Budgeting', 'EP Budgeting', 'Showbiz Budgeting', 'Gorilla'] },
  { category: 'Payroll & Finance', tools: ['EP Payroll', 'Cast & Crew', 'Wrapbook', 'Media Services'] },
  { category: 'Sales & Packaging', tools: ['FilmFreeway', 'Cinando', 'Slated', 'The Black List'] },
];

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as any },
});

const Landing = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
  }, []);

  const handleFilesChange = async (newFiles: File[]) => {
    setFiles(newFiles);
    if (newFiles.length === 0 || processing) return;
    if (newFiles.length > MAX_PENDING_FILES) { toast.error(`Maximum ${MAX_PENDING_FILES} files allowed`); return; }
    for (const f of newFiles) {
      if (f.size > MAX_PENDING_FILE_SIZE) { toast.error(`"${f.name}" exceeds the 20 MB limit`); return; }
    }
    setProcessing(true);
    try {
      const { id } = await createPendingUpload(newFiles);
      if (isAuthenticated) {
        navigate(`/dashboard?pendingUploadId=${id}&autoIntake=1`);
      } else {
        toast.info('Sign in to analyse your script');
        navigate(`/auth?redirect=${encodeURIComponent(`/dashboard?pendingUploadId=${id}&autoIntake=1`)}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to prepare upload');
      setProcessing(false);
    }
  };

  return (
    <div className="bg-[hsl(225,20%,4%)] text-foreground min-h-screen">

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[hsl(225,20%,4%)]/80 backdrop-blur-md border-b border-border/10">
        <span className="text-sm font-display font-bold tracking-[0.2em] uppercase text-foreground/90">IFFY</span>
        <button
          onClick={() => navigate('/auth')}
          className="text-xs font-display font-medium tracking-wide text-muted-foreground hover:text-foreground border border-border/30 hover:border-border/60 rounded-full px-4 py-1.5 transition-all duration-200"
        >
          Sign in
        </button>
      </nav>

      {/* ── Hero ── */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center">
        <motion.div {...fade(0.1)} className="mb-5">
          <span className="inline-flex items-center gap-2 text-xs font-display font-medium tracking-[0.2em] uppercase text-primary/70 border border-primary/20 rounded-full px-4 py-1.5">
            <Sparkles className="h-3 w-3" />
            AI-Native Film Development OS
          </span>
        </motion.div>

        <motion.h1 {...fade(0.2)} className="font-display font-bold text-foreground tracking-tight mb-3 max-w-2xl" style={{ fontSize: 'clamp(2.2rem, 7vw, 4rem)', lineHeight: 1.05 }}>
          Your next project
          <br />
          starts here.
        </motion.h1>
        <motion.p {...fade(0.25)} className="text-xs font-mono text-muted-foreground/30 tracking-widest mb-5 uppercase">
          Intelligent Film Flow &amp; Yield
        </motion.p>

        <motion.p {...fade(0.3)} className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed mb-14">
          Whether you have a finished script or a raw idea — IFFY takes you through development systematically and gets you to production-ready.
        </motion.p>

        {/* ── Dual entry ── */}
        <motion.div {...fade(0.4)} className="w-full max-w-2xl grid gap-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>

          {/* Card A — I have a script */}
          <div className="flex flex-col gap-5 rounded-2xl border border-border/20 bg-[hsl(225,20%,6%)] p-6 text-left hover:border-primary/20 transition-all duration-300">
            <div>
              <p className="text-xs font-mono text-primary/60 uppercase tracking-widest mb-2">Already have a script?</p>
              <h3 className="font-display font-semibold text-foreground text-lg leading-snug">Drop it in. Get clarity.</h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">IFFY reviews your script, identifies development gaps, and tells you exactly what to do next.</p>
            </div>
            <div className="[&_div:first-child>div:first-child]:border-border/30 [&_div:first-child>div:first-child]:bg-[hsl(225,20%,8%)]">
              <FileUpload files={files} onFilesChange={handleFilesChange} />
            </div>
            <p className="text-[10px] text-muted-foreground/40">Review takes about 60 seconds.</p>
          </div>

          {/* Card B — I have an idea */}
          <div className="flex flex-col justify-between gap-5 rounded-2xl border border-border/20 bg-[hsl(225,20%,6%)] p-6 text-left hover:border-primary/20 transition-all duration-300">
            <div>
              <p className="text-xs font-mono text-primary/60 uppercase tracking-widest mb-2">Starting from scratch?</p>
              <h3 className="font-display font-semibold text-foreground text-lg leading-snug">Build from idea to script.</h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">From a one-line idea, IFFY builds your concept brief, character bible, season arc, episode grid and full scripts — automatically.</p>
            </div>
            <div className="space-y-2">
              {['Concept Brief + Market Sheet', 'Character Bible + Season Arc', 'Episode Grid + Scripts'].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground/60">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/40 shrink-0" />
                  {step}
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate('/auth')}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground text-sm font-display font-medium py-3 hover:bg-primary/90 transition-colors"
            >
              Start developing <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

        </motion.div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 py-20 border-t border-border/10">
        <motion.div {...fade(0)} className="text-center mb-12">
          <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-3">How it works</p>
          <h2 className="font-display font-bold text-foreground" style={{ fontSize: 'clamp(1.6rem, 5vw, 2.5rem)' }}>Systematic. Auditable. Fast.</h2>
        </motion.div>
        <div className="max-w-3xl mx-auto grid gap-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            { num: '01', title: 'Define', body: 'IFFY locks in your concept, format, lane and market position before a single document is written.' },
            { num: '02', title: 'Generate', body: 'Each stage builds on the last — characters, arcs, episodes, scripts — all scored against a quality gate.' },
            { num: '03', title: 'Package', body: 'Export production-ready documents that plug straight into your existing tools and workflows.' },
          ].map((s, i) => (
            <motion.div key={s.num} {...fade(i * 0.1)} className="p-5 rounded-2xl border border-border/15 bg-[hsl(225,20%,5%)]">
              <p className="font-mono text-xs text-primary/40 mb-3">{s.num}</p>
              <h4 className="font-display font-semibold text-foreground mb-2">{s.title}</h4>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Compatibility ── */}
      <section className="px-6 py-20 border-t border-border/10 bg-[hsl(225,20%,5%)]">
        <motion.div {...fade(0)} className="text-center mb-12">
          <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-3">Works with your stack</p>
          <h2 className="font-display font-bold text-foreground" style={{ fontSize: 'clamp(1.6rem, 5vw, 2.5rem)' }}>Compatible with every major production tool</h2>
          <p className="text-muted-foreground text-sm mt-3 max-w-md mx-auto">IFFY generates structured documents that import directly into the software your production already uses.</p>
        </motion.div>
        <div className="max-w-4xl mx-auto space-y-6">
          {COMPAT_TOOLS.map((group, i) => (
            <motion.div key={group.category} {...fade(i * 0.08)} className="flex items-start gap-4">
              <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest pt-0.5 shrink-0 w-28">{group.category}</span>
              <div className="flex flex-wrap gap-2">
                {group.tools.map(tool => (
                  <span key={tool} className="text-xs text-muted-foreground/70 border border-border/20 rounded-full px-3 py-1 bg-[hsl(225,20%,6%)]">
                    {tool}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="px-6 py-24 border-t border-border/10 text-center">
        <motion.h2 {...fade(0)} className="font-display font-bold text-foreground mb-4" style={{ fontSize: 'clamp(1.8rem, 5vw, 3rem)' }}>
          Ready to develop smarter?
        </motion.h2>
        <motion.p {...fade(0.1)} className="text-muted-foreground text-sm mb-8 max-w-sm mx-auto">
          Join producers and writers using IFFY to develop film and television faster.
        </motion.p>
        <motion.button {...fade(0.2)} onClick={() => navigate('/auth')} className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-display font-medium text-sm rounded-full px-8 py-3 hover:bg-primary/90 transition-colors">
          Get started <ArrowRight className="h-4 w-4" />
        </motion.button>

        {/* Tour link */}
        <motion.div {...fade(0.4)} className="mt-16 flex flex-col items-center gap-3">
          <a href="#tour" className="flex flex-col items-center gap-2 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors group">
            <span className="text-xs font-display uppercase tracking-[0.25em]">Take the tour</span>
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}>
              <ChevronDown className="h-4 w-4" />
            </motion.div>
          </a>
        </motion.div>
      </section>

      {/* ── Animated Tour ── */}
      <div id="tour" className="border-t border-border/10">
        <div className="text-center py-16 px-6">
          <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-3">Interactive Tour</p>
          <h2 className="font-display font-bold text-foreground" style={{ fontSize: 'clamp(1.6rem, 5vw, 2.5rem)' }}>
            See IFFY in action
          </h2>
          <p className="text-muted-foreground text-sm mt-3 max-w-md mx-auto">
            Watch the full pipeline run — from idea to storyboard, finance model to shot list.
          </p>
        </div>
        <TourLoader />
      </div>

    </div>
  );
};

export default Landing;
