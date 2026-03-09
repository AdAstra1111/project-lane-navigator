import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionShell } from '../shared/SectionShell';
import { useInView } from '../hooks/useInView';
import { CheckCircle2, FileText, Sparkles, ChevronRight, Camera, Calendar, LayoutGrid } from 'lucide-react';

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
const SCRIPT_LINES = [
  { type: 'scene',    text: 'INT. GION OKIYA — CANDLELIT ROOM — NIGHT' },
  { type: 'action',  text: 'HANA sits at her writing desk. The candle flickers without wind.' },
  { type: 'char',    text: 'HANA' },
  { type: 'dialog',  text: 'Kaito... is that you?' },
  { type: 'action',  text: 'The ink in the brush pot SWIRLS — forming a single kanji.' },
  { type: 'char',    text: 'KAITO (V.O.)' },
  { type: 'dialog',  text: 'I never left you. Not truly.' },
];
const SCHEDULE_DAYS = [
  { day: 'Day 1', location: 'INT. GION OKIYA — NIGHT', scenes: ['Sc.3 — Hana discovers the ghost  · 2min', 'Sc.7 — First calligraphy vision  · 2min'] },
  { day: 'Day 2', location: 'EXT. GION STREET — DAWN', scenes: ['Sc.12 — Hana flees the okiya  · 2min'] },
  { day: 'Day 3', location: 'INT. SHRINE — DAY', scenes: ['Sc.18 — Final letter revealed  · 2min'] },
];
const SHOT_LIST_ITEMS = [
  { num: 1, type: 'Wide / Establishing', lens: '24mm', move: 'Static', desc: 'Candlelit room. Hana at desk. Ghost ink begins to move.' },
  { num: 2, type: 'Close-Up — Hana',    lens: '85mm', move: 'Slow push', desc: 'Her eyes wide. Breath held. Recognition.' },
  { num: 3, type: 'Insert — Ink pot',   lens: '100mm macro', move: 'Static', desc: 'Ink swirls, kanji forms. Rack to Hana.' },
];
const STORYBOARD_PANELS = [
  { label: 'Panel 1', shot: 'ELS — Okiya Room', img: 'https://image.tmdb.org/t/p/w780/roAYL9HPX1N74hOjCraWOI2ZDiP.jpg', mood: 'Stillness · Dread' },
  { label: 'Panel 2', shot: 'CU — Hana', img: 'https://image.tmdb.org/t/p/w780/naPmyLVo6iRRM4IIL90MovP7qVp.jpg', mood: 'Intimate · Grief' },
];

type Phase = 0|1|2|3|4|5|6|7|8|9|10|11;

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
  const [scriptLines, setScriptLines] = useState<typeof SCRIPT_LINES>([]);
  const [scheduleVisible, setScheduleVisible] = useState(0);
  const [shotVisible, setShotVisible] = useState(0);
  const [boardVisible, setBoardVisible] = useState(0);
  const [outputVisible, setOutputVisible] = useState(false);

  const reset = useCallback(() => {
    setPhase(0); setTypedIdea(''); setCiScore(0); setGpScore(0);
    setActivePipeline(-1); setDocLines([]); setLiveCi(78); setNotes(NOTES);
    setScriptLines([]); setScheduleVisible(0); setShotVisible(0);
    setBoardVisible(0); setOutputVisible(false);
  }, []);

  useEffect(() => {
    if (!inView) { reset(); return; }
    const t = setTimeout(() => setPhase(1), 400);
    return () => clearTimeout(t);
  }, [inView, reset]);

  // Phase 1 — type idea
  useEffect(() => {
    if (phase !== 1) return;
    let i = 0;
    const iv = setInterval(() => {
      setTypedIdea(IDEA_TEXT.slice(0, i + 1)); i++;
      if (i >= IDEA_TEXT.length) { clearInterval(iv); setTimeout(() => setPhase(2), 500); }
    }, 22);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 2 — scores
  useEffect(() => {
    if (phase !== 2) return;
    let ci = 0, gp = 0;
    const iv = setInterval(() => {
      ci = Math.min(ci + 3, 78); gp = Math.min(gp + 3, 82);
      setCiScore(ci); setGpScore(gp);
      if (ci >= 78 && gp >= 82) { clearInterval(iv); setTimeout(() => setPhase(3), 500); }
    }, 30);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 3 — pipeline
  useEffect(() => {
    if (phase !== 3) return;
    let idx = 0; setActivePipeline(0);
    const iv = setInterval(() => {
      idx++; setActivePipeline(idx);
      if (idx >= PIPELINE_STAGES.length - 1) { clearInterval(iv); setTimeout(() => setPhase(4), 400); }
    }, 280);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 4 — concept brief
  useEffect(() => {
    if (phase !== 4) return;
    setDocLines([]); let i = 0;
    const iv = setInterval(() => {
      setDocLines(prev => {
        // dedupe guard — never add same line twice
        if (prev.some(l => l === DOC_LINES[i])) return prev;
        return [...prev, DOC_LINES[i]];
      });
      setLiveCi(prev => Math.min(prev + 3, 91)); i++;
      if (i >= DOC_LINES.length) { clearInterval(iv); setTimeout(() => setPhase(5), 600); }
    }, 550);
    return () => { clearInterval(iv); setDocLines([]); };
  }, [phase]);

  // Phase 5 — notes
  useEffect(() => {
    if (phase !== 5) return;
    setNotes(NOTES.map(n => ({ ...n, resolved: false })));
    const t1 = setTimeout(() => { setNotes([{ ...NOTES[0], resolved: true }, { ...NOTES[1], resolved: false }]); setLiveCi(96); }, 1000);
    const t2 = setTimeout(() => { setNotes(NOTES.map(n => ({ ...n, resolved: true }))); setLiveCi(98); }, 2200);
    const t3 = setTimeout(() => setPhase(6), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [phase]);

  // Phase 6 — approval toast
  useEffect(() => {
    if (phase !== 6) return;
    const t = setTimeout(() => setPhase(7), 1600);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase 7 — episode script
  useEffect(() => {
    if (phase !== 7) return;
    setScriptLines([]); let i = 0;
    const iv = setInterval(() => {
      setScriptLines(prev => [...prev, SCRIPT_LINES[i]]); i++;
      if (i >= SCRIPT_LINES.length) { clearInterval(iv); setTimeout(() => setPhase(8), 800); }
    }, 450);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 8 — schedule
  useEffect(() => {
    if (phase !== 8) return;
    setScheduleVisible(0); let i = 0;
    const iv = setInterval(() => { i++; setScheduleVisible(i); if (i >= SCHEDULE_DAYS.length) { clearInterval(iv); setTimeout(() => setPhase(9), 600); } }, 600);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 9 — shot list
  useEffect(() => {
    if (phase !== 9) return;
    setShotVisible(0); let i = 0;
    const iv = setInterval(() => { i++; setShotVisible(i); if (i >= SHOT_LIST_ITEMS.length) { clearInterval(iv); setTimeout(() => setPhase(10), 600); } }, 500);
    return () => clearInterval(iv);
  }, [phase]);

  // Phase 10 — storyboard
  useEffect(() => {
    if (phase !== 10) return;
    setBoardVisible(0);
    const t1 = setTimeout(() => setBoardVisible(1), 400);
    const t2 = setTimeout(() => setBoardVisible(2), 1000);
    const t3 = setTimeout(() => setPhase(11), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [phase]);

  // Phase 11 — output fan + loop
  useEffect(() => {
    if (phase !== 11) return;
    setOutputVisible(true);
    const t = setTimeout(() => { reset(); setTimeout(() => setPhase(1), 500); }, 5000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  const tags = ['Period Drama', 'Strong Female Lead', 'International Appeal'];

  return (
    <section
      id="producer-demo"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 py-24 bg-[hsl(225,20%,4%)]"
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[180px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
        className="text-center mb-12 relative z-10"
      >
        <p className="text-xs font-display uppercase tracking-[0.3em] text-primary/60 mb-4">Live Demo</p>
        <h2 className="font-display font-bold text-foreground tracking-tight" style={{ fontSize: 'clamp(1.8rem, 6vw, 3rem)' }}>
          Watch IFFY Work
        </h2>
        <p className="text-muted-foreground mt-4 max-w-md mx-auto">
          From idea to episode script, schedule, shot list and storyboard — in one run.
        </p>
      </motion.div>

      <div ref={ref} className="relative z-10 w-full max-w-2xl">
        <div className="rounded-2xl border border-border/20 bg-[hsl(225,20%,6%)] shadow-[0_0_80px_hsl(38_60%_52%/0.06)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/10 bg-[hsl(225,20%,5%)]">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/50" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/50" />
            <span className="ml-3 text-[10px] font-mono text-muted-foreground/40">IFFY · Auto-Run · The Last Love Letter of Gion</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground/30">{Math.round((phase / 11) * 100)}%</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-0.5 bg-border/10 w-full">
            <motion.div
              className="h-full bg-primary/60"
              animate={{ width: `${Math.round((phase / 11) * 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>

          <div className="p-6 min-h-[420px] flex flex-col gap-5">

            {/* Phase 1 — Idea */}
            <AnimatePresence>
              {phase >= 1 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-primary/50">Idea Input</p>
                  <div className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 px-4 py-3">
                    <p className="font-mono text-sm text-foreground/80 leading-relaxed">
                      {typedIdea}{phase === 1 && <span className="animate-pulse text-primary">|</span>}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 2 — Scores */}
            <AnimatePresence>
              {phase >= 2 && phase <= 6 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[{ label: 'Creative Integrity', value: ciScore, color: 'hsl(38,60%,52%)' }, { label: 'Green Potential', value: gpScore, color: 'hsl(150,55%,50%)' }].map(({ label, value, color }) => (
                      <div key={label} className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-3">
                        <div className="flex justify-between mb-2">
                          <span className="text-[10px] font-mono text-muted-foreground/60">{label}</span>
                          <span className="text-[10px] font-mono font-bold" style={{ color }}>{value}</span>
                        </div>
                        <div className="h-1 rounded-full bg-border/20 overflow-hidden">
                          <motion.div className="h-full rounded-full" style={{ backgroundColor: color, width: `${value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {tags.map((tag, i) => (
                      <motion.span key={tag} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.15 }}
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono border border-primary/20 text-primary/70 bg-primary/5">
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
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-primary/50">Pipeline</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {PIPELINE_STAGES.map((stage, i) => (
                      <div key={stage} className="flex items-center gap-1">
                        <motion.div
                          animate={i === activePipeline ? { backgroundColor: 'hsl(38,60%,52%)', borderColor: 'hsl(38,60%,52%)', boxShadow: '0 0 12px hsl(38 60% 52% / 0.5)' }
                            : i < activePipeline ? { backgroundColor: 'hsl(150,55%,50%)', borderColor: 'hsl(150,55%,50%)' }
                            : { backgroundColor: 'transparent', borderColor: 'hsl(225,20%,20%)' }}
                          transition={{ duration: 0.3 }}
                          className="rounded-full border px-2 py-0.5"
                        >
                          <span className="text-[9px] font-mono text-foreground/70 whitespace-nowrap">{stage}</span>
                        </motion.div>
                        {i < PIPELINE_STAGES.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/20 flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 4 — Concept Brief */}
            <AnimatePresence>
              {phase >= 4 && phase <= 6 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-4 flex flex-col gap-1.5">
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-primary/60" />
                      <span className="text-[10px] font-mono text-primary/60">Concept Brief</span>
                    </div>
                    <motion.span key={liveCi} initial={{ scale: 1.3, color: 'hsl(38,60%,70%)' }} animate={{ scale: 1, color: 'hsl(38,60%,52%)' }} className="text-[10px] font-mono font-bold">
                      CI: {liveCi} ↑
                    </motion.span>
                  </div>
                  {docLines.map((line, i) => (
                    <motion.p key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="font-mono text-[11px] text-foreground/70">{line}</motion.p>
                  ))}
                  {phase === 4 && <span className="font-mono text-[11px] text-primary animate-pulse">|</span>}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 5 — Notes */}
            <AnimatePresence>
              {phase >= 5 && phase <= 6 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                  {notes.map((note) => (
                    <motion.div key={note.text}
                      animate={note.resolved ? { opacity: 0.4, scale: 0.98 } : { opacity: 1, scale: 1 }}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                      style={{ borderColor: note.resolved ? 'hsl(150,55%,50%,0.3)' : 'hsl(0,60%,50%,0.3)', background: note.resolved ? 'hsl(150,55%,50%,0.05)' : 'hsl(0,60%,50%,0.05)' }}>
                      {note.resolved
                        ? <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                        : <div className="h-2 w-2 rounded-full bg-red-500/70 flex-shrink-0" />}
                      <span className="text-[10px] font-mono text-foreground/60">{note.text}</span>
                      {note.resolved && <span className="ml-auto text-[9px] font-mono text-green-500/70">Resolved</span>}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 6 — Approval toast */}
            <AnimatePresence>
              {phase === 6 && (
                <motion.div initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                  <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs font-mono font-semibold text-primary">Season Arc approved · CI: 98 · GP: 96</p>
                    <p className="text-[10px] font-mono text-muted-foreground/60">Advancing → Episode Scripts</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 7 — Episode Script */}
            <AnimatePresence>
              {phase >= 7 && phase <= 9 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-lg bg-[hsl(225,20%,8%)] border border-border/10 p-4 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="h-3 w-3 text-primary/60" />
                    <span className="text-[10px] font-mono text-primary/60">Episode 1 · Scene 3</span>
                    <span className="ml-auto text-[9px] font-mono text-green-500/60">CI: 98</span>
                  </div>
                  {scriptLines.map((line, i) => (
                    <motion.p key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      className={`font-mono leading-relaxed ${
                        line.type === 'scene'   ? 'text-[9px] text-primary/70 font-bold tracking-wide' :
                        line.type === 'char'    ? 'text-[10px] text-foreground/80 font-bold text-center' :
                        line.type === 'dialog'  ? 'text-[11px] text-foreground/70 text-center px-4' :
                        'text-[10px] text-muted-foreground/60 italic'
                      }`}>
                      {line.text}
                    </motion.p>
                  ))}
                  {phase === 7 && <span className="font-mono text-[11px] text-primary animate-pulse">|</span>}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 8 — Schedule */}
            <AnimatePresence>
              {phase >= 8 && phase <= 9 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-primary/60" />
                    <span className="text-[10px] font-mono text-primary/60">Production Schedule</span>
                  </div>
                  {SCHEDULE_DAYS.slice(0, scheduleVisible).map((day) => (
                    <motion.div key={day.day} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      className="rounded-lg border border-border/10 bg-[hsl(225,20%,9%)] px-3 py-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-mono font-bold text-primary/70">{day.day}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/40">{day.location}</span>
                      </div>
                      {day.scenes.map(sc => (
                        <p key={sc} className="text-[9px] font-mono text-foreground/50 pl-2">{sc}</p>
                      ))}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 9 — Shot List */}
            <AnimatePresence>
              {phase >= 9 && phase <= 10 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Camera className="h-3 w-3 text-primary/60" />
                    <span className="text-[10px] font-mono text-primary/60">Shot List · Episode 1 Sc.3</span>
                  </div>
                  {SHOT_LIST_ITEMS.slice(0, shotVisible).map((shot) => (
                    <motion.div key={shot.num} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-3 rounded-lg border border-border/10 bg-[hsl(225,20%,9%)] px-3 py-2">
                      <span className="text-[9px] font-mono font-bold text-primary/60 mt-0.5 flex-shrink-0">{shot.num}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-display font-semibold text-foreground/80">{shot.type}</span>
                          <span className="text-[9px] font-mono text-primary/50">{shot.lens}</span>
                          <span className="text-[9px] font-mono text-muted-foreground/40">{shot.move}</span>
                        </div>
                        <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">{shot.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 10 — Storyboard */}
            <AnimatePresence>
              {phase >= 10 && phase <= 11 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <LayoutGrid className="h-3 w-3 text-primary/60" />
                    <span className="text-[10px] font-mono text-primary/60">Storyboard · Episode 1</span>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    {STORYBOARD_PANELS.slice(0, boardVisible).map((panel) => (
                      <motion.div key={panel.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                        className="rounded-xl border border-border/15 overflow-hidden bg-[hsl(225,20%,8%)]">
                        <div className="relative overflow-hidden" style={{ aspectRatio: '16/9' }}>
                          <img src={panel.img} alt={panel.shot} className="w-full h-full object-cover"
                            style={{ filter: 'grayscale(80%) contrast(1.2) brightness(0.8)' }} />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-mono text-white/70">{panel.label}</div>
                          <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-mono text-white/60">{panel.shot}</div>
                        </div>
                        <p className="px-2 py-1.5 text-[9px] font-mono text-muted-foreground/50">{panel.mood}</p>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 11 — Output fan */}
            <AnimatePresence>
              {phase === 11 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {OUTPUT_DOCS.map((doc, i) => (
                      <motion.div key={doc}
                        initial={{ opacity: 0, y: 20, rotate: (i % 3) - 1 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        transition={{ delay: i * 0.07, type: 'spring', stiffness: 140 }}
                        className="rounded-lg border border-primary/20 bg-primary/5 p-2 flex flex-col items-center gap-1">
                        <FileText className="h-4 w-4 text-primary/60" />
                        <p className="text-[8px] font-mono text-center text-foreground/60 leading-tight">{doc}</p>
                      </motion.div>
                    ))}
                  </div>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
                    className="text-center font-mono text-xs text-primary/80 font-semibold">
                    From idea to production-ready — in one run.
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
