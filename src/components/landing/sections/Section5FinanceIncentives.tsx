import { motion } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { Receipt, Globe, Calculator, BarChart3, Package } from 'lucide-react';

const cards = [
  { icon: Receipt, label: 'Tax Credits', description: 'Maximise incentive returns with territory-specific tax credit modelling and qualification tracking.', color: 'hsl(38,60%,52%)' },
  { icon: Globe, label: 'Co-Production Treaties', description: 'Navigate treaty requirements with automated compliance checking and points allocation.', color: 'hsl(200,65%,55%)' },
  { icon: Calculator, label: 'Production Budgets', description: 'Dynamic budget modelling with scenario analysis, cashflow projections, and cost tracking.', color: 'hsl(150,55%,50%)' },
  { icon: BarChart3, label: 'Recoupment Waterfalls', description: 'Model complex recoupment structures with corridor analysis and investor return projections.', color: 'hsl(280,55%,60%)' },
  { icon: Package, label: 'Investor Packaging', description: 'Auto-assembled investor packages built from approved creative and financial documents.', color: 'hsl(350,60%,55%)' },
];

export function Section5FinanceIncentives() {
  return (
    <SectionShell id="finance-incentives" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-16">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Financial Intelligence</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Creative Meets Finance
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          IFFY connects creative development directly to financial planning — so every decision has context.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl border border-border/20 bg-card/20 backdrop-blur-sm hover:border-primary/20 transition-all duration-500 group"
            >
              <div
                className="h-11 w-11 rounded-xl border flex items-center justify-center mb-4"
                style={{
                  backgroundColor: `color-mix(in srgb, ${card.color} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${card.color} 25%, transparent)`,
                }}
              >
                <Icon className="h-5 w-5" style={{ color: card.color }} />
              </div>
              <h3 className="text-base font-display font-semibold text-foreground mb-2">{card.label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
            </motion.div>
          );
        })}
      </div>
    </SectionShell>
  );
}
