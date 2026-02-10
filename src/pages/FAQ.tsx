import { motion } from 'framer-motion';
import { Header } from '@/components/Header';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

const faqs = [
  // ─── Core Concepts ───
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
    q: 'What does IFFY stand for?',
    a: 'Incentives, Finance, Foreign, and Yield — the four pillars of international film finance that IFFY helps you navigate.',
  },
  // ─── Readiness & Analysis ───
  {
    q: 'What is a "readiness score"?',
    a: 'It\'s a 0–100 assessment across four dimensions: Script (25%), Packaging (30%), Finance (25%), and Market (20%). It reflects how prepared your project is for financing conversations — not how good or bad the idea is.',
  },
  {
    q: 'How does IFFY decide my "best next step"?',
    a: 'It identifies the weakest dimension of your readiness score and recommends the single action most likely to improve it. If you have no director attached, that\'s more impactful than tweaking a finance scenario. IFFY prioritises accordingly.',
  },
  {
    q: 'What are monetization lanes?',
    a: 'IFFY classifies projects into seven lanes: Studio/Streamer, Independent Film, Low-Budget/Microbudget, International Co-Production, Genre/Market-Driven, Prestige/Awards, and Fast-Turnaround/Trend-Based. The lane determines which financing strategies, buyer types, and market windows are most relevant.',
  },
  {
    q: 'Can I use IFFY early in development?',
    a: 'Yes — that\'s the ideal time. IFFY is designed for pre-development and early development. The earlier you understand your finance pathway, the better your creative and packaging decisions will be.',
  },
  // ─── Finance Tracker ───
  {
    q: 'What is the Finance Tracker?',
    a: 'The Finance Tracker lets you log and manage all financing elements across six categories: Sales & Distribution (pre-sales, MGs, territory deals), Equity & Investment, Tax Incentives, Soft Money (grants, funds), Gap & Debt, and Other (deferments, in-kind). Each category tracks individual deals with status, amounts, and counterparties — giving you a real-time view of your capital stack.',
  },
  {
    q: 'How are deal totals calculated?',
    a: 'IFFY aggregates the minimum guarantee amounts of all closed deals across each financing category. This gives you a clear picture of secured versus pipeline financing. The waterfall chart on your project page visualises these totals against your budget to identify the remaining gap.',
  },
  // ─── Buyer Matching ───
  {
    q: 'How does buyer matching work?',
    a: 'IFFY cross-references your project\'s genre, format, budget, territory, and tone against a database of active industry buyers. Each match is scored across these dimensions, with the top three shown by default and the full ranked list available via a toggle. It\'s pattern-matching, not a guarantee of interest.',
  },
  {
    q: 'What is the Buyer CRM?',
    a: 'The Buyer CRM is your personal relationship manager for industry contacts. Track buyer details, meeting history, appetite notes, and follow-ups across all your projects. It integrates with the buyer matching engine so you can see which contacts align with specific projects.',
  },
  // ─── Pipeline & Stage Gates ───
  {
    q: 'What is the pipeline?',
    a: 'The pipeline is a Kanban-style overview of your projects across four stages: Development, Packaging, Financing, and Pre-Production. It gives you a portfolio-level view of where each project stands.',
  },
  {
    q: 'What are stage gates?',
    a: 'Stage gates are automated rules that determine when a project is ready to advance to the next pipeline stage. For example, moving from Development to Packaging requires an attached script, and moving to Financing requires cast and HOD attachments. This prevents premature advancement and ensures each project has the fundamentals before it moves forward.',
  },
  // ─── Smart Packaging & Cast ───
  {
    q: 'What is Smart Packaging?',
    a: 'Smart Packaging uses AI to recommend specific talent combinations — cast and directors — based on your project\'s budget, genre, lane, and current market trends. It optimises for both creative fit and financial viability, suggesting names that could meaningfully impact your project\'s financeability.',
  },
  {
    q: 'What is the AI Cast Explorer?',
    a: 'The Cast Explorer generates budget-appropriate casting recommendations beyond the database by analysing your full project context. Suggested names are clickable — each opens a Cast Info Dialog with market assessment, trajectory analysis, and direct links to Google Images and IMDb.',
  },
  // ─── Collaboration ───
  {
    q: 'Can I share my project with my team?',
    a: 'Yes. You can invite collaborators using a secure link. Each collaborator is assigned a role — Producer, Sales Agent, Lawyer, or Creative — which controls what sections they can see. Producers have full access; other roles see only the sections relevant to their function.',
  },
  {
    q: 'How do comments and discussions work?',
    a: 'Each project supports threaded comments that can be filtered by section. Team members can discuss specific aspects of the project — packaging, finance, scripts — in context, with real-time updates so everyone stays in sync.',
  },
  // ─── Trends & Market Intelligence ───
  {
    q: 'What are "trend signals"?',
    a: 'Trend signals are patterns detected across multiple independent sources — buyer appetite shifts, genre cycles, cast momentum, and market behaviours. IFFY requires signals to appear across three or more sources before surfacing them. They\'re matched to your project automatically based on genre, tone, format, and lane.',
  },
  {
    q: 'What are Cast Trends?',
    a: 'Cast Trends track actor momentum by region, age band, and trend type (Emerging, Accelerating, or Resurgent). Each entry includes genre relevance, market alignment, sales leverage, timing window, and the specific rationale — designed to feel like a quiet intelligence briefing, not celebrity gossip.',
  },
  {
    q: 'What is the Weekly Signal Brief?',
    a: 'A periodic summary of the most significant trend movements across story, cast, and market intelligence. It\'s designed to keep you current without noise.',
  },
  // ─── Tools & Export ───
  {
    q: 'What is the PDF One-Pager?',
    a: 'You can export a professional PDF directly from any project page. It includes the monetization lane, readiness score breakdown, IFFY verdict, budget, team attachments, finance scenarios, and top buyer matches — formatted for industry standards. Useful for sharing with financiers, sales agents, or co-producers.',
  },
  {
    q: 'Can I compare different versions of a project?',
    a: 'Yes. You can clone a project and all its data — cast, HODs, partners, scripts, and finance scenarios — to create variants. The comparison tool lets you evaluate side-by-side how changes in budget, cast, territory, or format impact readiness scores and market positioning.',
  },
  // ─── Incentives & Co-Production ───
  {
    q: 'How current are the tax incentives and co-production information?',
    a: 'Incentive data is researched and cached from verified government and industry sources. We flag confidence levels and last-verified dates. Always confirm specific programme details with local counsel or your accountant before relying on them for a finance plan.',
  },
  {
    q: 'What is the Co-Production Planner?',
    a: 'The Co-Production Planner evaluates official treaty frameworks, eligible countries, share percentages, and cultural requirements relevant to your project. It helps you model co-production structures before engaging legal counsel.',
  },
  // ─── Privacy & Data ───
  {
    q: 'Is my project data private?',
    a: 'Yes. Your projects, documents, and analysis are visible only to you and any collaborators you explicitly invite. IFFY does not share project data between users.',
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
