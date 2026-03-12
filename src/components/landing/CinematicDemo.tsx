/**
 * IFFY Cinematic Landing Demo — scroll-driven product showcase.
 *
 * Each section is wrapped in its own SectionErrorBoundary.
 * A single crashed section renders null silently — the rest of the tour continues.
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

/** Per-section error boundary — crashes silently to null, never propagates up. */
class SectionErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: Error) {
    // Non-fatal: log but do not rethrow
    console.warn('[CinematicDemo] Section error caught by boundary:', error?.message ?? error);
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}

export default function CinematicDemo() {
  return (
    <div className="relative">
      <SectionErrorBoundary><Section1CinematicIntro /></SectionErrorBoundary>
      <SectionErrorBoundary><SectionProducerDemo /></SectionErrorBoundary>
      <SectionErrorBoundary><Section3DualPipeline /></SectionErrorBoundary>
      <SectionErrorBoundary><SectionFinanceDemo /></SectionErrorBoundary>
      <SectionErrorBoundary><SectionVisualDev /></SectionErrorBoundary>
      <SectionErrorBoundary><SectionStudioMode /></SectionErrorBoundary>
      <SectionErrorBoundary><Section6StudioControl /></SectionErrorBoundary>
      <SectionErrorBoundary><Section9InvestorConfidence /></SectionErrorBoundary>
      <SectionErrorBoundary><Section10CTA /></SectionErrorBoundary>
    </div>
  );
}
