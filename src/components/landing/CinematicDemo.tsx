/**
 * IFFY Cinematic Landing Demo — 10-section scroll-driven experience.
 * Apple-grade product showcase for film development OS.
 */
import { SectionProducerDemo } from './sections/SectionProducerDemo';
import { Section3DualPipeline } from './sections/Section3DualPipeline';
import { Section6StudioControl } from './sections/Section6StudioControl';

export function CinematicDemo() {
  return (
    <div className="relative">
      <SectionProducerDemo />
      <Section3DualPipeline />
      <Section6StudioControl />
    </div>
  );
}
