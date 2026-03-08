import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';

const projects = [
  { name: 'Vengeance Red', type: 'Feature Film', stage: 'Packaging', progress: 85, color: 'hsl(38,60%,52%)' },
  { name: 'The Silence Protocol', type: 'Limited Series', stage: 'Development', progress: 45, color: 'hsl(200,65%,55%)' },
  { name: 'Midnight Frequency', type: 'Vertical Drama', stage: 'Production', progress: 92, color: 'hsl(150,55%,50%)' },
  { name: 'Glass Empire', type: 'Feature Film', stage: 'Pre-Production', progress: 68, color: 'hsl(280,55%,60%)' },
];

export function Section6StudioControl() {
  return (
    <SectionShell id="studio-control" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-16">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Studio Operations</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Multi-Project Control
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          Studios can scale development and production across their entire slate using IFFY.
        </p>
      </div>

      <div className="max-w-3xl mx-auto space-y-4">
        {projects.map((project, i) => (
          <motion.div
            key={project.name}
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.15 }}
            className="flex items-center gap-4 p-5 rounded-2xl border border-border/20 bg-card/20 backdrop-blur-sm hover:border-primary/15 transition-all duration-500"
          >
            <div
              className="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `color-mix(in srgb, ${project.color} 10%, transparent)`,
                borderColor: `color-mix(in srgb, ${project.color} 25%, transparent)`,
              }}
            >
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <h4 className="text-sm font-display font-semibold text-foreground truncate">{project.name}</h4>
                <span className="text-[10px] text-muted-foreground shrink-0">{project.type}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${project.progress}%` }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.15 + 0.3, duration: 1, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{project.stage}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionShell>
  );
}
