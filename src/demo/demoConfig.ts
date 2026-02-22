/**
 * IFFY Guided Demo — Configuration & Step Script
 * Entirely client-side with mock data. No backend required.
 */

// ── Configuration ──
export const DEMO_CONFIG = {
  projectName: 'Vengeance Red',
  companyName: 'Obsidian Pictures',
  autoplay: true,
  defaultChapterStart: 0,
  ctaLinks: {
    joinBeta: 'mailto:beta@iffy.dev?subject=Beta%20Access',
    partnerInvest: 'mailto:partners@iffy.dev?subject=Partnership%20Enquiry',
  },
};

// ── Mock Data ──
export interface MockDoc {
  id: string;
  name: string;
  type: string;
  versions: MockVersion[];
  approved_version: number; // version_number
}

export interface MockVersion {
  version_number: number;
  label: string;
  status: 'draft' | 'approved' | 'superseded';
  created_at: string;
  change_summary: string;
}

export interface MockNote {
  id: string;
  title: string;
  body: string;
  severity: 'critical' | 'major' | 'minor';
  status: 'open' | 'resolved';
  category: string;
  canon_risk?: boolean;
}

export const MOCK_DOCS: MockDoc[] = [
  {
    id: 'doc-script',
    name: `${DEMO_CONFIG.projectName} — Screenplay`,
    type: 'screenplay',
    versions: [
      { version_number: 1, label: 'First draft', status: 'superseded', created_at: '2026-01-15', change_summary: 'Initial screenplay draft — 102 pages.' },
      { version_number: 2, label: 'Notes pass v2', status: 'approved', created_at: '2026-02-01', change_summary: 'Structural notes applied. Act 2 tightened, 97 pages.' },
    ],
    approved_version: 2,
  },
  {
    id: 'doc-market',
    name: `${DEMO_CONFIG.projectName} — Market Sheet`,
    type: 'market_sheet',
    versions: [
      { version_number: 1, label: 'Market positioning v1', status: 'approved', created_at: '2026-02-03', change_summary: 'Genre comps, territory targets, and buyer mapping.' },
    ],
    approved_version: 1,
  },
  {
    id: 'doc-format',
    name: `${DEMO_CONFIG.projectName} — Format Rules`,
    type: 'format_rules',
    versions: [
      { version_number: 1, label: 'Format rules v1', status: 'approved', created_at: '2026-02-04', change_summary: 'Runtime, tone, structural expectations for narrative feature.' },
    ],
    approved_version: 1,
  },
  {
    id: 'doc-bible',
    name: `${DEMO_CONFIG.projectName} — Character Bible`,
    type: 'character_bible',
    versions: [
      { version_number: 1, label: 'Bible v1', status: 'approved', created_at: '2026-02-05', change_summary: '6 principal characters. Arcs, relationships, backstory.' },
    ],
    approved_version: 1,
  },
  {
    id: 'doc-brief',
    name: `${DEMO_CONFIG.projectName} — Development Brief`,
    type: 'brief',
    versions: [
      { version_number: 1, label: 'Brief v1', status: 'approved', created_at: '2026-01-20', change_summary: 'Core concept, thesis, audience, and strategic positioning.' },
    ],
    approved_version: 1,
  },
];

export const MOCK_NOTES: MockNote[] = [
  {
    id: 'note-1',
    title: 'Act 2 midpoint lacks reversal',
    body: 'The midpoint at page 52 reads as a soft escalation rather than a true reversal. The protagonist\'s discovery should reframe the entire central conflict.',
    severity: 'critical',
    status: 'open',
    category: 'Structure',
  },
  {
    id: 'note-2',
    title: 'Secondary antagonist motivation unclear',
    body: 'Detective Morales\' motivation for protecting the evidence is never dramatised. Add a scene showing personal stakes by end of Act 1.',
    severity: 'major',
    status: 'open',
    category: 'Character',
  },
  {
    id: 'note-3',
    title: 'Opening scene contradicts established timeline',
    body: 'Scene 1 places the inciting incident in November, but Scene 14 references it as "last spring". This creates a canon violation.',
    severity: 'major',
    status: 'open',
    category: 'Canon',
    canon_risk: true,
  },
];

export const DEV_ENGINE_STEPS = [
  { id: 'idea', label: 'Idea / Logline', status: 'converged' as const },
  { id: 'brief', label: 'Development Brief', status: 'converged' as const },
  { id: 'market', label: 'Market Positioning', status: 'converged' as const },
  { id: 'format', label: 'Format Rules', status: 'converged' as const },
  { id: 'bible', label: 'Character Bible', status: 'converged' as const },
  { id: 'screenplay', label: 'Screenplay', status: 'active' as const },
  { id: 'notes', label: 'Notes & Review', status: 'pending' as const },
  { id: 'package', label: 'Project Package', status: 'pending' as const },
];

// ── Demo Step Script ──
export type DemoView =
  | 'cold-open'
  | 'suite-map'
  | 'magic-trick'
  | 'library'
  | 'dev-engine'
  | 'notes'
  | 'package'
  | 'differentiators'
  | 'cta';

export type DemoAction = 'APPLY_FIX' | 'APPROVE_VERSION' | 'OPEN_PACKAGE' | null;

export interface DemoStep {
  id: string;
  chapter: string;
  title: string;
  durationMs: number;
  view: DemoView;
  spotlightSelector: string | null;
  overlayText: string;
  narrationText: string;
  action: DemoAction;
}

export const DEMO_CHAPTERS = [
  'The Problem',
  'What IFFY Is',
  'Suite Map',
  'The Magic Trick',
  'Ingest & Library',
  'Development Engine',
  'Notes & Canon',
  'Packaging',
  'Why It\'s Different',
  'Get Started',
];

export const DEMO_STEPS: DemoStep[] = [
  // ── CHAPTER: The Problem ──
  {
    id: 'cold-1',
    chapter: 'The Problem',
    title: 'Version chaos',
    durationMs: 4000,
    view: 'cold-open',
    spotlightSelector: null,
    overlayText: 'Version chaos',
    narrationText: 'Development is where movies are won or lost — but the process is still chaos. Scripts live in email threads. Notes live in PDFs. "Final" becomes "Final_v12".',
    action: null,
  },
  {
    id: 'cold-2',
    chapter: 'The Problem',
    title: 'Note chaos',
    durationMs: 3500,
    view: 'cold-open',
    spotlightSelector: null,
    overlayText: 'Note chaos',
    narrationText: 'Teams lose track of what was approved, what changed, and what\'s canon.',
    action: null,
  },
  {
    id: 'cold-3',
    chapter: 'The Problem',
    title: 'Canon drift',
    durationMs: 3500,
    view: 'cold-open',
    spotlightSelector: null,
    overlayText: 'Canon drift',
    narrationText: 'And the cost isn\'t just time — it\'s bad decisions, slow packaging, and projects stalling.',
    action: null,
  },
  {
    id: 'cold-4',
    chapter: 'The Problem',
    title: 'Packaging scramble',
    durationMs: 3500,
    view: 'cold-open',
    spotlightSelector: null,
    overlayText: 'Packaging scramble',
    narrationText: '',
    action: null,
  },

  // ── CHAPTER: What IFFY Is ──
  {
    id: 'promise-1',
    chapter: 'What IFFY Is',
    title: 'The development OS',
    durationMs: 8000,
    view: 'cold-open',
    spotlightSelector: null,
    overlayText: 'A development operating system',
    narrationText: 'IFFY fixes this by turning development into a system. IFFY ingests your project, guides the next step, tracks decisions across versions, and outputs an investor-ready package — with continuity intact.',
    action: null,
  },

  // ── CHAPTER: Suite Map ──
  {
    id: 'map-1',
    chapter: 'Suite Map',
    title: 'The pipeline',
    durationMs: 10000,
    view: 'suite-map',
    spotlightSelector: null,
    overlayText: 'Ingest → Dev Engine → Notes & Canon → Packaging → Export',
    narrationText: 'Think of it as a pipeline: Ingest your documents. Run a guided development engine. Generate notes safely. Protect canon across episodic and longform. And auto-build the package from what\'s approved.',
    action: null,
  },

  // ── CHAPTER: The Magic Trick ──
  {
    id: 'magic-1',
    chapter: 'The Magic Trick',
    title: 'A note arrives',
    durationMs: 6000,
    view: 'magic-trick',
    spotlightSelector: '[data-demo="note-highlight"]',
    overlayText: 'Watch what happens when we apply one change',
    narrationText: 'Here\'s the moment that usually breaks teams. We get a note. We apply it.',
    action: null,
  },
  {
    id: 'magic-2',
    chapter: 'The Magic Trick',
    title: 'Apply the fix',
    durationMs: 5000,
    view: 'magic-trick',
    spotlightSelector: '[data-demo="apply-fix-btn"]',
    overlayText: 'New version created (not overwritten)',
    narrationText: 'The system creates a new version — not a messy overwrite.',
    action: 'APPLY_FIX',
  },
  {
    id: 'magic-3',
    chapter: 'The Magic Trick',
    title: 'Approval holds',
    durationMs: 5000,
    view: 'magic-trick',
    spotlightSelector: '[data-demo="version-tray"]',
    overlayText: 'Approval stays meaningful',
    narrationText: 'Approvals stay meaningful. And the package updates from the latest approved truth.',
    action: 'APPROVE_VERSION',
  },
  {
    id: 'magic-4',
    chapter: 'The Magic Trick',
    title: 'Package updates',
    durationMs: 5000,
    view: 'magic-trick',
    spotlightSelector: '[data-demo="package-badge"]',
    overlayText: 'Package updates automatically',
    narrationText: '',
    action: 'OPEN_PACKAGE',
  },

  // ── CHAPTER: Ingest & Library ──
  {
    id: 'lib-1',
    chapter: 'Ingest & Library',
    title: 'Source of truth',
    durationMs: 10000,
    view: 'library',
    spotlightSelector: null,
    overlayText: 'One source of truth — Versioned. Searchable. Auditable.',
    narrationText: 'First: IFFY becomes the single source of truth. Every project file is versioned. The latest approved version is clearly marked. And the team always knows what\'s current — without relying on memory or inbox archaeology.',
    action: null,
  },

  // ── CHAPTER: Development Engine ──
  {
    id: 'dev-1',
    chapter: 'Development Engine',
    title: 'Guided pipeline',
    durationMs: 12000,
    view: 'dev-engine',
    spotlightSelector: null,
    overlayText: 'A guided development pipeline — Momentum, not confusion',
    narrationText: 'Then: the Development Engine. Instead of jumping between random documents, IFFY guides the workflow step by step — idea, brief, market positioning, format rules, and beyond. Each stage produces structured outputs you can actually use, and the system tells you what\'s next — and why.',
    action: null,
  },

  // ── CHAPTER: Notes & Canon ──
  {
    id: 'notes-1',
    chapter: 'Notes & Canon',
    title: 'Safe iteration',
    durationMs: 12000,
    view: 'notes',
    spotlightSelector: null,
    overlayText: 'Resolve notes safely — Protect canon across episodes',
    narrationText: 'Now the part producers care about most: notes. IFFY generates actionable notes, and when you resolve one, it doesn\'t destroy history — it creates a new version and keeps a clear audit trail. For episodic work, it can also separate "canon-risk" notes — changes that would break continuity — so fixes stay safe across episodes and seasons.',
    action: null,
  },

  // ── CHAPTER: Packaging ──
  {
    id: 'pkg-1',
    chapter: 'Packaging',
    title: 'Auto-populated',
    durationMs: 10000,
    view: 'package',
    spotlightSelector: null,
    overlayText: 'Package builds itself — Always investor-ready',
    narrationText: 'And here\'s the unlock: packaging. IFFY auto-builds the Project Package from what\'s approved. So instead of scrambling for the latest synopsis, bible, script, or positioning — the package is always current, consistent, and ready to share.',
    action: null,
  },

  // ── CHAPTER: Why It's Different ──
  {
    id: 'diff-1',
    chapter: "Why It's Different",
    title: 'Not a chatbot',
    durationMs: 12000,
    view: 'differentiators',
    spotlightSelector: null,
    overlayText: 'Not a chatbot. An OS.',
    narrationText: 'IFFY isn\'t a chatbot that writes text. It\'s an operating system that manages development as a living project. It\'s versioned and auditable — so approvals mean something. And it protects continuity — so episodic and longform stay coherent as you iterate.',
    action: null,
  },

  // ── CHAPTER: Get Started ──
  {
    id: 'cta-1',
    chapter: 'Get Started',
    title: 'Join us',
    durationMs: 15000,
    view: 'cta',
    spotlightSelector: null,
    overlayText: 'Development, organised.',
    narrationText: 'We\'re building the standard operating system for story development — so projects move faster, decisions get clearer, and packages become effortless. If you\'re a producer or studio team who wants to move smarter, join the beta. If you\'re an investor or strategic partner, we\'ll show you the roadmap and the wedge. IFFY: development, organised.',
    action: null,
  },
];
