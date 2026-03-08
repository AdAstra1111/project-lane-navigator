import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { LayoutGrid, ListChecks, FileText, UsersRound } from 'lucide-react';

const features = [
  { icon: LayoutGrid, label: 'Storyboards', description: 'AI-generated visual direction from approved scripts, maintaining canon consistency across episodes.', color: 'hsl(38,60%,52%)' },
  { icon: ListChecks, label: 'Shot Lists', description: 'Precise shot breakdowns with camera direction, framing, and coverage requirements.', color: 'hsl(200,65%,55%)' },
  { icon: FileText, label: 'Production Instructions', description: 'Structured production notes with scene requirements, VFX callouts, and practical considerations.', color: 'hsl(150,55%,50%)' },
  { icon: UsersRound, label: 'Team Coordination', description: 'Multiple production teams working simultaneously with clear creative alignment and canon protection.', color: 'hsl(280,55%,60%)' },
];

export function Section4ProductionDirection() {
  return (
    <SectionShell id="production-direction" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-16">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Production Direction</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Precise Creative Direction
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          IFFY produces production-ready direction that keeps multiple teams aligned.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {features.map((f, i) => {
          const Icon = f.icon;
          return (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="group p-6 rounded-2xl border border-border/20 bg-card/20 backdrop-blur-sm hover:border-primary/20 hover:bg-primary/[0.03] transition-all duration-500"
            >
              <div
                className="h-12 w-12 rounded-xl border flex items-center justify-center mb-4"
                style={{
                  backgroundColor: `color-mix(in srgb, ${f.color} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${f.color} 25%, transparent)`,
                }}
              >
                <Icon className="h-5 w-5" style={{ color: f.color }} />
              </div>
              <h3 className="text-lg font-display font-semibold text-foreground mb-2">{f.label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </motion.div>
          );
        })}
      </div>
    </SectionShell>
  );
}
