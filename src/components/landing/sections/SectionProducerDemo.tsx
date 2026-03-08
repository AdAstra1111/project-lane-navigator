import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import { CheckCircle2, FileText, Sparkles, ChevronRight } from 'lucide-react';

const IDEA_TEXT = 'A young geisha in 1920s Kyoto discovers her dead lover\'s ghost is trapped inside her calligraphy ink...';

const PIPELINE_STAGES = ['Idea', 'Concept Brief', 'Character Bible', 'Season Arc', 'Episode Grid', 'Season Scripts'];

const DOC_LINES = [
  'TITLE: The Last Love Letter of Gion',
  'FORMAT: Vertical Drama · 30 × 2 min',
  'LOGLINE: A grieving geisha discovers her lover\'s ghost',
  'MARKET FIT: Premium streaming · Asia / Global',
  'TONE: Melancholic, supernatural, visually lush',
];

const NOTES = [
  { text: 'Antagonist motivations undefined', resolved: false },
  { text: 'Episode 1 hooks conflict', resolved: false },
];

const OUTPUT_DOCS = [
  'Concept Brief', 'Market Sheet', 'Format Rules',
  'Character Bible', 'Season Arc', 'Episode Grid',
  'Episode Beats', 'Season Scripts',
];

type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function SectionProducerDemo() {
  const { ref, inView } = useInView({ threshold: 0.2 });
  const [phase, setPhase] = useState<Phase>(0);
  const [typedIdea, setTypedIdea] = useState('');
  const [ciScore, setCiScore] = useState(0);
  const [gpScore, setGpScore] = useState(0);
  const [activePipeline, setActivePipeline] = useState(-1);
  const [docLines, setDocLines] = useState<string[]>([]);
  const [liveCi, setLiveCi] = useState(78);
  const [notes, setNotes] = useState(NOTES);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [outputVisible, setOutputVisible] = useState(false);

  const reset = useCallback(() => {
    setPhase(0);
    setTypedIdea('');
    setCiScore(0);
    setGpScore(0);
    setActivePipeline(-1);
    setDocLines([]);
    setLiveCi(78);
    setNotes(NOTES);
    setResolvedCount(0);
    setOutputVisible(false);
  }, []);

  useEffect(() => {
    if (!inView) return;
    reset();
    const t = setTimeout(() => setPhase(1), 400);
    return () => clearTimeout(t);
  }, [inView, reset]);

  // Phase 1 — type the idea
  useEffect(() => {
    if (phase !== 1) return;
    let i = 0;
    const interval = setInterval(() => {
      setTypedIdea(IDEA_TEXT.slice(0, i + 1));
      i++;
      if (i >= IDEA_TEXT.length) {
        clearInterval(interval);
        setTimeout(() => setPhase(2), 600);
      }
    }, 28);
    return () => clearInterval(interval);
  }, [phase]);

  // Phase 2 — animate CI/GP scores
  useEffect(() => {
    if (phase !== 2) return;
    let ci = 0, gp = 0;
    const interval = setInterval(() => {
      ci = Math.min(ci + 2, 78);
      gp = Math.min(gp + 2, 82);
      setCiScore(ci);
      setGpScore(gp);
      if (ci >= 78 && gp >= 82) {
        clearInterval(interval);
        setTimeout(() => setPhase(3), 700);
      }
    }, 35);
    return () => clearInterval(interval);
  }, [phase]);

  // Phase 3 — pipeline lights up
  useEffect(() => {
    if (phase !== 3) return;
    let idx = 0;
    setActivePipeline(0);
    const interval = setInterval(() => {
      idx++;
      setActivePipeline(idx);
      if (idx >= PIPELINE_STAGES.length - 1) {
        clearInterval(interval);
        setTimeout(() => { setActivePipeline(1); setPhase(4); }, 600);
      }
    }, 350);
    return () => clearInterval(interval);
  }, [phase]);

  // Phase 4 — doc lines appear
  useEffect(() => {
    if (phase !== 4) return;
    setDocLines([]);
    let i = 0;
    const interval = setInterval(() => {
      setDocLines(prev => [...prev, DOC_LINES[i]]);
      setLiveCi(prev => Math.min(prev + 3, 91));
      i++;
      if (i >= DOC_LINES.length) {
        clearInterval(interval);
        setTimeout(() => setPhase(5), 700);
      }
    }, 700);
    return () => clearInterval(interval);
  }, [phase]);

  // Phase 5 — resolve notes, CI ticks up
  useEffect(() => {
    if (phase !== 5) return;
    setNotes(NOTES.map(n => ({ ...n, resolved: false })));
    setTimeout(() => {
      setNotes([{ ...NOTES[0], resolved: true }, { ...NOTES[1], resolved: false }]);
      setLiveCi(96);
      setResolvedCount(1);
    }, 1200);
    setTimeout(() => {
      setNotes(NOTES.map(n => ({ ...n, resolved: true })));
      setLiveCi(98);
      setResolvedCount(2);
      setTimeout(() => setPhase(6), 800);
    }, 2600);
  }, [phase]);

  // Phase 6 → 7
  useEffect(() => {
    if (phase !== 6) return;
    setTimeout(() => setPhase(7), 1800);
  }, [phase]);

  // Phase 7 — output fan
  useEffect(() => {
    if (phase !== 7) return;
    setOutputVisible(true);
    // Loop after 5s
    const t = setTimeout(() => { reset(); setTimeout(() => setPhase(1), 500); }, 5000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  const tags = ['Period Drama', 'Strong Female Lead', 'International Appeal'];

  return (
    <section
      id="producer-demo"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 py-24 bg-[hsl(225,20%,4%)]"
    >
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[180px] pointer-events-none" />

      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
        className="text-center mb-12 relative z-10"
      >
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/60 mb-4">Live Demo</p>
        <h2 className="font-display text-3xl sm:text-5xl font-bold text-foreground tracking-tight">
          Watch IFFY Work
        </h2>
        <p className="text-muted-foreground mt-4 max-w-md mx-auto">
          A complete vertical drama developed in real time.
        </p>
      </motion.div>

      {/* Demo panel */}
      <div ref={ref} className="relative z-10 w-full max-w-2xl">
        <div className="rounded-2xl border border-border/20 bg-[hsl(225,20%,6%)] shadow-[0_0_80px_hsl(38_60%_52%/0.06)] overflow-hidden">
          {/* Panel chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/10 bg-[hsl(225,20%,5%)]">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/50" />
            <span className="ml-3 text-[10px] font-mono text-muted-foreground/40">IFFY · Auto-Run · The Last Love Letter of Gion</span>
          </div>

          <div className="p-6 min-h-[380px] flex flex-col gap-5">

            {/* Phase 1 — Idea typing */}
            <AnimatePresence>
              {phase >= 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-2"
                >
                  <p className="text-[10px] font-mono uppercase tracking-widest text-primary/50">Idea Input</p>
                  <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-3">
                    <p className="font-mono text-sm text-foreground/80 leading-relaxed">
                      {typedIdea}
                      {phase === 1 && <span className="animate-pulse text-primary">|</span>}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 2 — Scores + tags */}
            <AnimatePresence>
              {phase >= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-3"
                >
                  <div className="grid grid-cols-2 gap-3">
                    {[{ label: 'Cinematic Index', value: ciScore, max: 78, color: 'hsl(38,60%,52%)' }, { label: 'Green Potential', value: gpScore, max: 82, color: 'hsl(150,55%,50%)' }].map(({ label, value, max, color }) => (
                      <div key={label} className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-3">
                        <div className="flex justify-between mb-2">
                          <span className="text-[10px] font-mono text-muted-foreground/60">{label}</span>
                          <span className="text-[10px] font-mono font-bold" style={{ color }}>{value}</span>
                        </div>
                        <div className="h-1 rounded-full bg-border/20 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: color, width: `${(value / 100) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {tags.map((tag, i) => (
                      <motion.span
                        key={tag}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.2 }}
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-primary/20 text-primary/70 bg-primary/5"
                      >
                        {tag}
                      </motion.span>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 3 — Pipeline */}
            <AnimatePresence>
              {phase >= 3 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-2"
                >
                  <p className="text-[10px] font-mono uppercase tracking-widest text-primary/50">Pipeline</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {PIPELINE_STAGES.map((stage, i) => (
                      <div key={stage} className="flex items-center gap-1">
                        <motion.div
                          animate={
                            i === activePipeline
                              ? { backgroundColor: 'hsl(38,60%,52%)', borderColor: 'hsl(38,60%,52%)', boxShadow: '0 0 12px hsl(38 60% 52% / 0.5)' }
                              : i < activePipeline
                              ? { backgroundColor: 'hsl(150,55%,50%)', borderColor: 'hsl(150,55%,50%)' }
                              : { backgroundColor: 'transparent', borderColor: 'hsl(225,20%,20%)' }
                          }
                          transition={{ duration: 0.3 }}
                          className="rounded-full border px-2 py-0.5"
                        >
                          <span className="text-[9px] font-mono text-foreground/70 whitespace-nowrap">{stage}</span>
                        </motion.div>
                        {i < PIPELINE_STAGES.length - 1 && (
                          <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/20 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 4 — Doc writing */}
            <AnimatePresence>
              {phase >= 4 && phase < 7 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-4 flex flex-col gap-1.5"
                >
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-primary/60" />
                      <span className="text-[10px] font-mono text-primary/60">Concept Brief</span>
                    </div>
                    <motion.span
                      key={liveCi}
                      initial={{ scale: 1.3, color: 'hsl(38,60%,70%)' }}
                      animate={{ scale: 1, color: 'hsl(38,60%,52%)' }}
                      className="text-[10px] font-mono font-bold"
                    >
                      CI: {liveCi} ↑
                    </motion.span>
                  </div>
                  {docLines.map((line, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="font-mono text-[11px] text-foreground/70"
                    >
                      {line}
                    </motion.p>
                  ))}
                  {phase === 4 && <span className="font-mono text-[11px] text-primary animate-pulse">|</span>}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 5 — Notes */}
            <AnimatePresence>
              {phase >= 5 && phase < 7 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-2"
                >
                  {notes.map((note, i) => (
                    <motion.div
                      key={note.text}
                      animate={note.resolved ? { opacity: 0.4, scale: 0.98 } : { opacity: 1, scale: 1 }}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                      style={{ borderColor: note.resolved ? 'hsl(150,55%,50%,0.3)' : 'hsl(0,60%,50%,0.3)', background: note.resolved ? 'hsl(150,55%,50%,0.05)' : 'hsl(0,60%,50%,0.05)' }}
                    >
                      <AnimatePresence mode="wait">
                        {note.resolved ? (
                          <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                            <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                          </motion.div>
                        ) : (
                          <motion.div key="dot" className="h-2 w-2 rounded-full bg-red-500/70 flex-shrink-0" />
                        )}
                      </AnimatePresence>
                      <span className="text-[10px] font-mono text-foreground/60">{note.text}</span>
                      {note.resolved && <span className="ml-auto text-[9px] font-mono text-green-500/70">Resolved</span>}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 6 — Promotion toast */}
            <AnimatePresence>
              {phase === 6 && (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3"
                >
                  <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs font-mono font-semibold text-primary">Season Arc approved</p>
                    <p className="text-[10px] font-mono text-muted-foreground/60">CI: 98 · GP: 96 · Advancing to Episode Grid</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 7 — Output docs fan */}
            <AnimatePresence>
              {phase === 7 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-3"
                >
                  <div className="grid grid-cols-4 gap-2">
                    {OUTPUT_DOCS.map((doc, i) => (
                      <motion.div
                        key={doc}
                        initial={{ opacity: 0, y: 20, rotate: (i % 3) - 1 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        transition={{ delay: i * 0.08, type: 'spring', stiffness: 140 }}
                        className="rounded-lg border border-primary/20 bg-primary/5 p-2 flex flex-col items-center gap-1"
                      >
                        <FileText className="h-4 w-4 text-primary/60" />
                        <p className="text-[8px] font-mono text-center text-foreground/60 leading-tight">{doc}</p>
                      </motion.div>
                    ))}
                  </div>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="text-center font-mono text-xs text-primary/80 font-semibold"
                  >
                    Production-ready in 20 minutes.
                  </motion.p>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </section>
  );
}
