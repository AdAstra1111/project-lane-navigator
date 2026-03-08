/**
 * SectionVisualDev — Animated demo for Shot Lists and Storyboards
 * Reference: "How to Date Billy Walsh" (Paradox House / Amazon Prime, 2024)
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import { Camera, LayoutGrid, ChevronRight, Aperture, Maximize2, Move } from 'lucide-react';

// ── SHOT LIST DEMO ──
const SCENE = 'INT. HEATHBROOK ACADEMY — CORRIDOR — DAY';

const SHOTS = [
  {
    num: 1,
    type: 'Wide / Establishing',
    lens: '24mm',
    move: 'Static',
    framing: 'ELS',
    description: 'Billy walks the crowded corridor. Students part around him. Archie watches from his locker.',
    composition: { subject: 'center', depth: 'deep', subjects: 2 },
  },
  {
    num: 2,
    type: 'Medium Two-Shot',
    lens: '50mm',
    move: 'Push in',
    framing: 'MS',
    description: 'Archie and Amelia exchange a look. Unspoken. Billy rounds the corner into frame.',
    composition: { subject: 'left-right', depth: 'mid', subjects: 2 },
  },
  {
    num: 3,
    type: 'Close-Up — Archie',
    lens: '85mm',
    move: 'Static',
    framing: 'CU',
    description: 'Archie\'s expression shifts — recognition, dread, something like jealousy.',
    composition: { subject: 'center-left', depth: 'shallow', subjects: 1 },
  },
  {
    num: 4,
    type: 'OTS — Billy to Amelia',
    lens: '85mm',
    move: 'Rack focus',
    framing: 'OTS',
    description: 'Over Archie\'s shoulder: Billy flashes the smile. Amelia laughs. The world narrows.',
    composition: { subject: 'right', depth: 'shallow', subjects: 2 },
  },
  {
    num: 5,
    type: 'Tracking — Corridor',
    lens: '35mm',
    move: 'Lateral track R→L',
    framing: 'MWS',
    description: 'Camera follows Archie as he turns away, the corridor noise swallowing him.',
    composition: { subject: 'moving', depth: 'mid', subjects: 1 },
  },
];

// Mini frame composition visual
function FrameComposition({ shot }: { shot: typeof SHOTS[0] }) {
  const { subject, depth, subjects } = shot.composition;
  return (
    <div className="relative w-16 h-10 rounded border border-border/20 bg-[hsl(225,20%,10%)] overflow-hidden flex-shrink-0">
      {/* Rule of thirds grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-foreground/60" />
        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-foreground/60" />
        <div className="absolute top-1/3 left-0 right-0 h-px bg-foreground/60" />
        <div className="absolute top-2/3 left-0 right-0 h-px bg-foreground/60" />
      </div>
      {/* Subject silhouettes */}
      {subject === 'center' && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-2 h-4 rounded-t-full bg-primary/50" />
      )}
      {subject === 'center-left' && (
        <div className="absolute bottom-1 left-[35%] -translate-x-1/2 w-2.5 h-5 rounded-t-full bg-primary/60" />
      )}
      {subject === 'left-right' && (
        <>
          <div className="absolute bottom-1 left-[28%] -translate-x-1/2 w-2 h-4 rounded-t-full bg-primary/50" />
          <div className="absolute bottom-1 left-[72%] -translate-x-1/2 w-2 h-4 rounded-t-full bg-muted-foreground/40" />
        </>
      )}
      {subject === 'right' && (
        <>
          <div className="absolute bottom-1 left-[20%] w-3 h-3 rounded-t-full bg-muted-foreground/30 blur-[1px]" />
          <div className="absolute bottom-1 left-[65%] -translate-x-1/2 w-2.5 h-5 rounded-t-full bg-primary/60" />
        </>
      )}
      {subject === 'moving' && (
        <motion.div
          animate={{ x: [0, -12, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-1 left-1/2 -translate-x-1/2 w-2 h-4 rounded-t-full bg-primary/50"
        />
      )}
      {/* Depth indicator */}
      {depth === 'shallow' && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary/10" />
      )}
    </div>
  );
}

function ShotListDemo() {
  const { ref, inView } = useInView({ threshold: 0.2 });
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!inView) { setVisible(0); return; }
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisible(i);
      if (i >= SHOTS.length) clearInterval(interval);
    }, 400);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <div ref={ref} className="flex flex-col gap-2">
      {/* Scene header */}
      <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-3 py-2 flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-primary/60">{SCENE}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40">{SHOTS.length} shots</span>
      </div>

      {SHOTS.slice(0, visible).map((shot, i) => (
        <motion.div
          key={shot.num}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border border-border/10 bg-[hsl(225,20%,8%)] p-3 flex gap-3"
        >
          {/* Shot number */}
          <div className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="text-[10px] font-mono font-bold text-primary">{shot.num}</span>
          </div>

          {/* Frame comp */}
          <FrameComposition shot={shot} />

          {/* Shot info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-xs font-display font-semibold text-foreground/85">{shot.type}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[hsl(225,20%,12%)] text-muted-foreground/50">{shot.framing}</span>
              <span className="text-[9px] font-mono text-primary/50">{shot.lens}</span>
              <span className="text-[9px] font-mono text-muted-foreground/40 flex items-center gap-0.5">
                <Move className="h-2.5 w-2.5" />{shot.move}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/55 leading-relaxed">{shot.description}</p>
          </div>
        </motion.div>
      ))}

      {visible >= SHOTS.length && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/10 bg-[hsl(225,20%,7%)]"
        >
          <span className="text-[10px] font-mono text-muted-foreground/40">Scene coverage: complete</span>
          <span className="text-[10px] font-mono text-green-500/60">✓ Production-ready</span>
        </motion.div>
      )}
    </div>
  );
}

// ── STORYBOARD DEMO ──
const TMDB_W = 'https://image.tmdb.org/t/p/w780';

const PANELS = [
  {
    num: 1,
    label: 'Panel 1',
    shot: 'ELS — Corridor',
    img: `${TMDB_W}/roAYL9HPX1N74hOjCraWOI2ZDiP.jpg`,
    direction: 'Natural school light floods from windows L. Background bokeh of students. Billy enters frame R.',
    mood: 'Bright · Open · Arrival',
    color: 'hsl(38,60%,52%)',
  },
  {
    num: 2,
    label: 'Panel 2',
    shot: 'MS — Archie & Amelia',
    img: `${TMDB_W}/kggJIpJFJoZI7qdapcolJBiKYCl.jpg`,
    direction: 'Warm ambient. Amelia animated. Archie subdued. Eye-line converges on Billy off-screen R.',
    mood: 'Warm · Tense · Unspoken',
    color: 'hsl(200,65%,55%)',
  },
  {
    num: 3,
    label: 'Panel 3',
    shot: 'CU — Archie',
    img: `${TMDB_W}/naPmyLVo6iRRM4IIL90MovP7qVp.jpg`,
    direction: '85mm, shallow DOF. Corridor noise fades. Only Archie\'s face. Subtle rack to soft background.',
    mood: 'Intimate · Quiet · Dread',
    color: 'hsl(280,55%,60%)',
  },
  {
    num: 4,
    label: 'Panel 4',
    shot: 'OTS — Billy smiles',
    img: `${TMDB_W}/xHhDA63HYklr4FMdxAd05FqhhhF.jpg`,
    direction: 'Archie\'s shoulder anchors frame L. Billy and Amelia sharp R. Warm practical from window.',
    mood: 'Excluded · Bittersweet',
    color: 'hsl(350,60%,55%)',
  },
];

// Storyboard panel using real film stills styled as sketch frames
function StoryboardPanel({ panel, active }: { panel: typeof PANELS[0]; active: boolean }) {
  return (
    <motion.div
      animate={{
        borderColor: active ? `${panel.color}60` : 'hsl(225,20%,18%)',
        boxShadow: active ? `0 0 20px ${panel.color}18` : 'none',
      }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border overflow-hidden bg-[hsl(225,20%,6%)]"
    >
      {/* Film still styled as storyboard sketch */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <img
          src={panel.img}
          alt={panel.shot}
          className="w-full h-full object-cover"
        />
        {/* Active colour tint */}
        <motion.div
          className="absolute inset-0"
          animate={{ opacity: active ? 0.12 : 0 }}
          transition={{ duration: 0.3 }}
          style={{ background: panel.color }}
        />
        {/* Panel label */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white/70 backdrop-blur-sm">
          {panel.label}
        </div>
        {/* Shot type */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-white/60 bg-black/50 px-1.5 py-0.5 rounded backdrop-blur-sm">
            {panel.shot}
          </span>
          {active && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="h-2 w-2 rounded-full"
              style={{ background: panel.color, boxShadow: `0 0 6px ${panel.color}` }}
            />
          )}
        </div>
      </div>

      {/* Panel info */}
      <div className="p-2.5">
        <p className="text-[10px] font-mono text-muted-foreground/55 leading-relaxed mb-1.5">{panel.direction}</p>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: `${panel.color}12`, color: panel.color, border: `1px solid ${panel.color}25` }}>
          {panel.mood}
        </span>
      </div>
    </motion.div>
  );
}

function StoryboardDemo() {
  const { ref, inView } = useInView({ threshold: 0.2 });
  const [activePanel, setActivePanel] = useState(0);
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!inView) { setVisible(0); setActivePanel(0); return; }
    // Reveal panels
    let i = 0;
    const reveal = setInterval(() => {
      i++;
      setVisible(i);
      if (i >= PANELS.length) clearInterval(reveal);
    }, 350);
    // Cycle active panel
    const cycle = setInterval(() => {
      setActivePanel(p => (p + 1) % PANELS.length);
    }, 2500);
    return () => { clearInterval(reveal); clearInterval(cycle); };
  }, [inView]);

  return (
    <div ref={ref} className="flex flex-col gap-3">
      <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-3 py-2 flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-primary/60">{SCENE}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40">AI storyboard · {PANELS.length} panels</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PANELS.slice(0, visible).map((panel, i) => (
          <motion.div
            key={panel.num}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
          >
            <StoryboardPanel panel={panel} active={activePanel === i} />
          </motion.div>
        ))}
      </div>
      {visible >= PANELS.length && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/10 bg-[hsl(225,20%,7%)]"
        >
          <span className="text-[10px] font-mono text-muted-foreground/40">Canon-locked · How to Date Billy Walsh</span>
          <span className="text-[10px] font-mono text-green-500/60">✓ Approved for production</span>
        </motion.div>
      )}
    </div>
  );
}

// ── MAIN SECTION ──
const TABS = [
  { key: 'shotlist',   label: 'Shot List',  icon: Camera,     color: 'hsl(38,60%,52%)',  tagline: 'Scene-by-scene coverage plan' },
  { key: 'storyboard', label: 'Storyboard', icon: LayoutGrid, color: 'hsl(200,65%,55%)', tagline: 'AI visual direction per panel' },
] as const;
type TabKey = typeof TABS[number]['key'];

export function SectionVisualDev() {
  const [activeTab, setActiveTab] = useState<TabKey>('shotlist');
  const active = TABS.find(t => t.key === activeTab)!;

  return (
    <SectionShell id="visual-dev" className="bg-[hsl(225,20%,4%)]">
      <div className="text-center mb-10">
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/50 mb-4">Visual Production</p>
        <h2 className="text-3xl sm:text-5xl font-display font-bold text-foreground tracking-tight">
          Shot Lists & Storyboards
        </h2>
        <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
          IFFY generates production-ready shot lists and storyboard panels directly from approved scripts — canon-locked and ready for the shoot.
        </p>
      </div>

      <div className="max-w-3xl mx-auto">
        {/* Tab selector */}
        <div className="flex gap-2 mb-6 justify-center">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-display font-medium transition-all duration-200"
                style={{
                  borderWidth: 1, borderStyle: 'solid',
                  borderColor: isActive ? tab.color : 'hsl(225,20%,18%)',
                  background: isActive ? `${tab.color}12` : 'transparent',
                  color: isActive ? tab.color : 'hsl(225,10%,55%)',
                }}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Demo panel */}
        <div className="rounded-2xl border border-border/15 bg-[hsl(225,20%,6%)] overflow-hidden">
          {/* Chrome */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/10 bg-[hsl(225,20%,5%)]">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/40" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/40" />
              <span className="ml-2 text-[10px] font-mono text-muted-foreground/30">IFFY · {active.label}</span>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/30">{active.tagline}</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="p-5"
            >
              {activeTab === 'shotlist' && <ShotListDemo />}
              {activeTab === 'storyboard' && <StoryboardDemo />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </SectionShell>
  );
}
