import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';

const STATS = [
  { value: '9', unit: 'stages', label: 'From raw idea to production-ready scripts — every document built and scored automatically.' },
  { value: '20', unit: 'mins', label: 'Average time to generate a complete vertical drama bible, arc and episode grid.' },
  { value: '71+', unit: 'tools', label: 'Capabilities across development, finance, casting, production and market intelligence.' },
  { value: '8', unit: 'formats', label: 'Pipeline formats — feature film, TV series, vertical drama, limited series, documentary and more.' },
];

const QUOTES = [
  {
    text: 'IFFY removes the bottleneck between a great idea and a greenlight-ready package. What used to take months now takes hours.',
    name: 'Sebastian Street',
    title: 'Producer · Paradox House',
  },
];

export function Section9InvestorConfidence() {
  return (
    <SectionShell id="investor-confidence" className="bg-[hsl(225,20%,5%)]">
      <div className="text-center mb-14">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">By the Numbers</p>
        <h2 className="font-display font-bold text-foreground tracking-tight" style={{ fontSize: 'clamp(1.8rem, 6vw, 3.5rem)' }}>
          Development at a Different Speed
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          IFFY compresses months of development work into hours — without sacrificing quality or creative control.
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4 mb-14" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.value}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] p-6 flex flex-col gap-2"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-primary" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', lineHeight: 1 }}>
                  {stat.value}
                </span>
                <span className="text-sm font-mono text-primary/50">{stat.unit}</span>
              </div>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Quote */}
        {QUOTES.map((q, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center max-w-2xl mx-auto"
          >
            <p className="text-lg font-display text-foreground/85 leading-relaxed italic mb-6">
              "{q.text}"
            </p>
            <div>
              <p className="text-sm font-display font-semibold text-foreground/80">{q.name}</p>
              <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{q.title}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionShell>
  );
}
