/**
 * IFFY Cinematic Landing Demo — 10-section scroll-driven experience.
 * Apple-grade product showcase for film development OS.
 */
import { useRef } from 'react';
import { SectionProducerDemo } from './sections/SectionProducerDemo';
import { SectionStudioMode } from './sections/SectionStudioMode';
import { Section3DualPipeline } from './sections/Section3DualPipeline';
import { Section6StudioControl } from './sections/Section6StudioControl';

export function CinematicDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative">
      <SectionProducerDemo />
      <Section3DualPipeline />
      <SectionStudioMode />
      <Section6StudioControl />
    </div>
  );
}
