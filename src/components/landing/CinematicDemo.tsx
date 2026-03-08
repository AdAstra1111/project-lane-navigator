/**
 * IFFY Cinematic Landing Demo — scroll-driven product showcase.
 */
import { Section1CinematicIntro } from './sections/Section1CinematicIntro';
import { SectionProducerDemo } from './sections/SectionProducerDemo';
import { Section3DualPipeline } from './sections/Section3DualPipeline';
import { SectionFinanceDemo } from './sections/SectionFinanceDemo';
import { SectionVisualDev } from './sections/SectionVisualDev';
import { SectionStudioMode } from './sections/SectionStudioMode';
import { Section6StudioControl } from './sections/Section6StudioControl';
import { Section9InvestorConfidence } from './sections/Section9InvestorConfidence';
import { Section10CTA } from './sections/Section10CTA';

export default function CinematicDemo() {
  return (
    <div className="relative">
      <Section1CinematicIntro />
      <SectionProducerDemo />
      <Section3DualPipeline />
      <SectionFinanceDemo />
      <SectionVisualDev />
      <SectionStudioMode />
      <Section6StudioControl />
      <Section9InvestorConfidence />
      <Section10CTA />
    </div>
  );
}
