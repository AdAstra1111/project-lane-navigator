import { motion } from 'framer-motion';
import { Check, X, Zap, Crown, Building2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSubscription, Plan } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    icon: Zap,
    plan: 'free' as Plan,
    description: 'Get started with core features',
    features: [
      { label: '2 projects', included: true },
      { label: '5 AI analyses / month', included: true },
      { label: '3 cast/HOD research / month', included: true },
      { label: '10 buyer contacts', included: true },
      { label: '1 finance scenario per project', included: true },
      { label: '100MB document storage', included: true },
      { label: 'Script coverage', included: false },
      { label: 'Comp analysis', included: false },
      { label: 'Smart packaging', included: false },
      { label: 'PDF/XLS export', included: false },
      { label: 'Team seats', included: false },
    ],
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/mo',
    icon: Crown,
    plan: 'pro' as Plan,
    popular: true,
    description: 'For active producers & sales agents',
    features: [
      { label: '15 projects', included: true },
      { label: '100 AI analyses / month', included: true },
      { label: '50 cast/HOD research / month', included: true },
      { label: 'Unlimited buyer contacts', included: true },
      { label: 'Unlimited finance scenarios', included: true },
      { label: '5GB document storage', included: true },
      { label: 'Script coverage', included: true },
      { label: 'Comp analysis', included: true },
      { label: 'Smart packaging', included: true },
      { label: 'PDF/XLS export', included: true },
      { label: '3 seats (+$15/seat)', included: true },
    ],
  },
  {
    name: 'Enterprise',
    price: '$199',
    period: '/mo',
    icon: Building2,
    plan: 'enterprise' as Plan,
    description: 'For studios & production companies',
    features: [
      { label: 'Unlimited projects', included: true },
      { label: 'Unlimited AI analyses', included: true },
      { label: 'Unlimited research', included: true },
      { label: 'Unlimited buyer contacts', included: true },
      { label: 'Unlimited finance scenarios', included: true },
      { label: '50GB document storage', included: true },
      { label: 'Script coverage', included: true },
      { label: 'Comp analysis', included: true },
      { label: 'Smart packaging', included: true },
      { label: 'PDF/XLS export', included: true },
      { label: '10 seats (+$10/seat)', included: true },
    ],
  },
];

export default function Pricing() {
  const { plan: currentPlan, loading } = useSubscription();

  const handleSelectPlan = (plan: Plan) => {
    if (plan === 'free') return;
    // Stripe checkout will be wired here later
    console.log('Checkout for plan:', plan);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-12 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Scale your film & TV intelligence as your slate grows. All plans include a 14-day Pro trial.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((tier, i) => {
            const isCurrent = tier.plan === currentPlan;
            const Icon = tier.icon;
            return (
              <motion.div
                key={tier.plan}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cn(
                  'glass-card rounded-2xl p-6 flex flex-col relative',
                  tier.popular && 'ring-2 ring-primary shadow-lg'
                )}
              >
                {tier.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                    Most Popular
                  </Badge>
                )}

                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <h2 className="font-display font-bold text-lg text-foreground">{tier.name}</h2>
                </div>

                <div className="mb-1">
                  <span className="text-3xl font-bold text-foreground">{tier.price}</span>
                  <span className="text-muted-foreground text-sm">{tier.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6">{tier.description}</p>

                <ul className="space-y-2 flex-1 mb-6">
                  {tier.features.map((f) => (
                    <li key={f.label} className="flex items-center gap-2 text-sm">
                      {f.included ? (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      )}
                      <span className={cn(f.included ? 'text-foreground' : 'text-muted-foreground/60')}>
                        {f.label}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={tier.popular ? 'default' : 'outline'}
                  disabled={isCurrent || loading}
                  onClick={() => handleSelectPlan(tier.plan)}
                >
                  {isCurrent ? 'Current Plan' : tier.plan === 'free' ? 'Free Forever' : 'Upgrade'}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
