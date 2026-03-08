/**
 * IFFY Cinematic Landing Demo — 10-section scroll-driven experience.
 * Apple-grade product showcase for film development OS.
 */
import { useRef } from 'react';
import { Section1CinematicIntro } from './sections/Section1CinematicIntro';
import { Section2AutoplayWalkthrough } from './sections/Section2AutoplayWalkthrough';
import { Section3DualPipeline } from './sections/Section3DualPipeline';
import { Section4ProductionDirection } from './sections/Section4ProductionDirection';
import { Section5FinanceIncentives } from './sections/Section5FinanceIncentives';
import { Section6StudioControl } from './sections/Section6StudioControl';
import { Section7AIPipeline } from './sections/Section7AIPipeline';
import { Section8LiveSimulation } from './sections/Section8LiveSimulation';
import { Section9InvestorConfidence } from './sections/Section9InvestorConfidence';
import { Section10CTA } from './sections/Section10CTA';

export function CinematicDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative">
      <Section1CinematicIntro />
      <Section2AutoplayWalkthrough />
      <Section3DualPipeline />
      <Section4ProductionDirection />
      <Section5FinanceIncentives />
      <Section6StudioControl />
      <Section7AIPipeline />
      <Section8LiveSimulation />
      <Section9InvestorConfidence />
      <Section10CTA />
    </div>
  );
}
