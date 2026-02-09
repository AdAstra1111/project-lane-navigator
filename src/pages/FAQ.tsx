import { motion } from 'framer-motion';
import { Header } from '@/components/Header';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

const faqs = [
  {
    q: 'What does "finance-ready" mean?',
    a: 'Finance-ready means your project has enough packaging (cast, director, partners), a viable capital stack, and market timing that a financier or buyer can engage with it seriously. It doesn\'t mean the money is in the bank — it means you\'re ready to have that conversation.',
  },
  {
    q: 'Is IFFY judging my script?',
    a: 'No. IFFY evaluates the financeability of your project — not the quality of your writing. Script analysis looks at structural clarity, market positioning, and how the material supports packaging decisions. It\'s not a creative note.',
  },
  {
    q: 'Does IFFY replace sales agents or lawyers?',
    a: 'Absolutely not. IFFY is a decision-support tool. It helps you prepare your project so that conversations with sales agents, lawyers, and financiers are more productive. It\'s what happens before those conversations, not instead of them.',
  },
  {
    q: 'How current are the tax incentives and co-production information?',
    a: 'Incentive data is researched and cached from verified government and industry sources. We flag confidence levels and last-verified dates. Always confirm specific programme details with local counsel or your accountant before relying on them for a finance plan.',
  },
  {
    q: 'Can I use IFFY early in development?',
    a: 'Yes — that\'s the ideal time. IFFY is designed for pre-development and early development. The earlier you understand your finance pathway, the better your creative and packaging decisions will be.',
  },
  {
    q: 'What is a "readiness score"?',
    a: 'It\'s a 0–100 assessment across four dimensions: Script (25%), Packaging (30%), Finance (25%), and Market (20%). It reflects how prepared your project is for financing conversations — not how good or bad the idea is.',
  },
  {
    q: 'What are "trend signals"?',
    a: 'Trend signals are patterns detected across multiple independent sources — buyer appetite shifts, genre cycles, cast momentum, and market behaviours. IFFY matches relevant signals to your project automatically.',
  },
  {
    q: 'How does IFFY decide my "best next step"?',
    a: 'It identifies the weakest dimension of your readiness score and recommends the single action most likely to improve it. If you have no director attached, that\'s more impactful than tweaking a finance scenario. IFFY prioritises accordingly.',
  },
  {
    q: 'Is my project data private?',
    a: 'Yes. Your projects, documents, and analysis are visible only to you. IFFY does not share project data between users.',
  },
  {
    q: 'What does IFFY stand for?',
    a: 'Incentives, Finance, Foreign, and Yield — the four pillars of international film finance that IFFY helps you navigate.',
  },
];

export default function FAQ() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-16 space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-3"
        >
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight">
            Frequently Asked Questions
          </h1>
          <p className="text-muted-foreground text-lg">
            Short answers to common questions. If something isn't covered here, it probably means IFFY handles it automatically.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <Accordion type="multiple" className="space-y-2">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="glass-card rounded-lg border-none">
                <AccordionTrigger className="px-5 py-4 hover:no-underline text-left">
                  <span className="font-display font-semibold text-foreground text-sm">{faq.q}</span>
                </AccordionTrigger>
                <AccordionContent className="px-5 pb-4 pt-0">
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </main>
    </div>
  );
}
