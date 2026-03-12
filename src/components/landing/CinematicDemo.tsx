/**
 * IFFY Cinematic Landing Demo — scroll-driven product showcase.
 *
 * Each section is wrapped in its own SectionErrorBoundary.
 * A single crashed section renders null silently — the rest of the tour continues.
 * SectionProducerDemo has an additional static fallback so "Watch IFFY Work"
 * is always visible even if the animated version fails.
 */
import { Component, type ReactNode } from 'react';
import { Section1CinematicIntro } from './sections/Section1CinematicIntro';
import { SectionProducerDemo } from './sections/SectionProducerDemo';
import { Section3DualPipeline } from './sections/Section3DualPipeline';
import { SectionFinanceDemo } from './sections/SectionFinanceDemo';
import { SectionVisualDev } from './sections/SectionVisualDev';
import { SectionStudioMode } from './sections/SectionStudioMode';
import { Section6StudioControl } from './sections/Section6StudioControl';
import { Section9InvestorConfidence } from './sections/Section9InvestorConfidence';
import { Section10CTA } from './sections/Section10CTA';

/** Per-section error boundary — crashes render null silently, never propagates up. */
class SectionErrorBoundary extends Component<
  { children: ReactNode; label?: string; fallback?: ReactNode },
  { crashed: boolean }
> {
  constructor(props: { children: ReactNode; label?: string; fallback?: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[CinematicDemo] Section error:', this.props.label, error?.message ?? error);
  }
  render() {
    if (this.state.crashed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

/** Static fallback for "Watch IFFY Work" — no state, no timers, never crashes. */
function SectionProducerStatic() {
  const steps = [
    { label: 'Idea Input', detail: 'A young geisha in 1920s Kyoto…' },
    { label: 'Creative Integrity Score', detail: 'CI: 78 · GP: 82' },
    { label: 'Pipeline', detail: 'Idea → Concept Brief → Character Bible → Season Arc → Scripts' },
    { label: 'Concept Brief', detail: 'TITLE: The Last Love Letter of Gion' },
    { label: 'Episode Script', detail: 'INT. GION OKIYA — CANDLELIT ROOM — NIGHT' },
    { label: 'Production Schedule', detail: 'Day 1–3 · 3 locations · 4 scenes' },
    { label: 'Shot List', detail: '3 shots · Wide, Close-Up, Insert' },
    { label: 'Storyboard', detail: '2 panels generated' },
  ];
  return (
    <section
      id="producer-demo"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 py-24 bg-[hsl(225,20%,4%)]"
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[180px] pointer-events-none" />
      <div className="text-center mb-12 relative z-10">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/60 mb-4">Live Demo</p>
        <h2 className="font-display font-bold text-foreground tracking-tight" style={{ fontSize: 'clamp(1.8rem, 6vw, 3rem)' }}>
          Watch IFFY Work
        </h2>
        <p className="text-muted-foreground mt-4 max-w-md mx-auto">
          From idea to episode script, schedule, shot list and storyboard — in one run.
        </p>
      </div>
      <div className="relative z-10 w-full max-w-2xl">
        <div className="rounded-2xl border border-border/20 bg-[hsl(225,20%,6%)] shadow-[0_0_80px_hsl(38_60%_52%/0.06)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/10 bg-[hsl(225,20%,5%)]">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/50" />
            <span className="ml-3 text-[10px] font-mono text-muted-foreground/40">IFFY · Auto-Run · The Last Love Letter of Gion</span>
            <span className="ml-auto text-[9px] font-mono text-muted-foreground/30">100%</span>
          </div>
          <div className="h-0.5 bg-primary/60 w-full" />
          <div className="p-6 flex flex-col gap-4">
            {steps.map((step) => (
              <div key={step.label} className="flex flex-col gap-0.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-primary/50">{step.label}</p>
                <p className="font-mono text-[11px] text-foreground/70">{step.detail}</p>
              </div>
            ))}
            <p className="text-center font-mono text-xs text-primary/80 font-semibold mt-2">
              From idea to production-ready — in one run.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function CinematicDemo() {
  return (
    <div className="relative">
      <SectionErrorBoundary label="Section1"><Section1CinematicIntro /></SectionErrorBoundary>
      <SectionErrorBoundary label="ProducerDemo" fallback={<SectionProducerStatic />}>
        <SectionProducerDemo />
      </SectionErrorBoundary>
      <SectionErrorBoundary label="Section3"><Section3DualPipeline /></SectionErrorBoundary>
      <SectionErrorBoundary label="FinanceDemo"><SectionFinanceDemo /></SectionErrorBoundary>
      <SectionErrorBoundary label="VisualDev"><SectionVisualDev /></SectionErrorBoundary>
      <SectionErrorBoundary label="StudioMode"><SectionStudioMode /></SectionErrorBoundary>
      <SectionErrorBoundary label="Section6"><Section6StudioControl /></SectionErrorBoundary>
      <SectionErrorBoundary label="Section9"><Section9InvestorConfidence /></SectionErrorBoundary>
      <SectionErrorBoundary label="Section10"><Section10CTA /></SectionErrorBoundary>
    </div>
  );
}
