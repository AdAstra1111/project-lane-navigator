/**
 * Pitch.tsx — Bespoke investor/partner presentation for IFFY.
 * Public route (/pitch) — no authentication required.
 * Rebuilt with actual project outputs as proof.
 */

import iffyLogo from '@/assets/iffy-logo-v3.png';

const gold = '#c49a3d';
const goldLight = '#e8c870';
const bg = '#090c14';
const bgCard = '#0f1420';
const bgCardAlt = '#0c1018';
const fg = '#e2e0dc';
const fgMuted = '#8a8880';

const stat = (n: string, label: string) => (
  <div className="flex flex-col items-center gap-1 text-center">
    <span style={{ color: gold, fontFamily: 'Fraunces, Georgia, serif', fontSize: '2.5rem', fontWeight: 700, lineHeight: 1 }}>{n}</span>
    <span style={{ color: fgMuted, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
  </div>
);

const rule = (num: string, title: string, body: string) => (
  <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
    <div style={{ color: gold, fontFamily: 'Fraunces, Georgia, serif', fontSize: '1.1rem', fontWeight: 700, minWidth: 28, marginTop: 2 }}>{num}</div>
    <div>
      <div style={{ color: fg, fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>{title}</div>
      <div style={{ color: fgMuted, fontSize: '0.8rem', lineHeight: 1.55 }}>{body}</div>
    </div>
  </div>
);

const capability = (icon: string, title: string, desc: string) => (
  <div style={{ background: bgCard, border: `1px solid rgba(196,154,61,0.15)`, borderRadius: 12, padding: '1.75rem' }}>
    <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{icon}</div>
    <div style={{ color: fg, fontFamily: 'Fraunces, Georgia, serif', fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</div>
    <div style={{ color: fgMuted, fontSize: '0.85rem', lineHeight: 1.6 }}>{desc}</div>
  </div>
);

export default function Pitch() {
  return (
    <div style={{ background: bg, color: fg, fontFamily: 'DM Sans, system-ui, sans-serif', minHeight: '100vh' }}>

      {/* ── 1. HERO ─────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: '4rem 2rem', position: 'relative', overflow: 'hidden',
      }} className="print:min-h-0 print:py-16">
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(196,154,61,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <img src={iffyLogo} alt="IFFY" style={{ height: 56, width: 56, marginBottom: '1.5rem', opacity: 0.95 }} />
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
          Film Intelligence
        </div>
        <h1 style={{
          fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
          fontWeight: 700, lineHeight: 1.1, maxWidth: 760, marginBottom: '1.5rem', letterSpacing: '-0.01em',
        }}>
          From Inception<br /><span style={{ color: gold }}>to Legacy.</span>
        </h1>
        <p style={{ color: fgMuted, fontSize: '1.1rem', maxWidth: 540, lineHeight: 1.7, marginBottom: '3rem' }}>
          The operating system for content development — from the first idea to a complete,
          production-ready series package. Every stage. Every decision. One system.
        </p>
        <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {stat('60', 'Episodes scripted overnight')}
          {stat('22', 'Documents per project')}
          {stat('418', 'Autonomous pipeline steps')}
          {stat('12×', 'Faster than a writers\' room')}
        </div>
      </section>

      {/* ── 2. THE PROBLEM ──────────────────────────────────────── */}
      <section style={{ padding: '6rem 2rem', maxWidth: 900, margin: '0 auto', textAlign: 'center' }}
        className="print:py-12 print:break-before-page">
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>The Problem</div>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 600, lineHeight: 1.2, marginBottom: '2rem' }}>
          The most expensive stage of filmmaking<br /><span style={{ color: gold }}>produces the least.</span>
        </h2>
        <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 680, margin: '0 auto 3rem' }}>
          Development is where the industry haemorrhages money. Brilliant projects die not because
          of talent, but because of time, cost, and the chaos of the process. The average studio
          spends 18 months and hundreds of thousands of pounds to reach greenlight — and 9 in 10
          projects never get there.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem', textAlign: 'center' }}>
          {[
            ['9 in 10', 'Developed projects never get made'],
            ['18 months', 'Average time from idea to greenlight'],
            ['£500k+', 'Development cost per studio project'],
            ['$220bn', 'Global streaming content spend annually'],
          ].map(([n, l]) => (
            <div key={n} style={{ padding: '1.5rem', background: bgCardAlt, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              {stat(n, l)}
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. WHAT IFFY IS ─────────────────────────────────────── */}
      <section style={{ padding: '6rem 2rem', background: bgCardAlt }} className="print:py-12 print:break-before-page">
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>The Solution</div>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 600, lineHeight: 1.2, maxWidth: 700, margin: '0 auto 1.5rem' }}>
              IFFY is the operating system<br /><span style={{ color: gold }}>for content development.</span>
            </h2>
            <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
              Not a script generator. A complete intelligence layer that manages every stage —
              from the first idea to a greenlight-ready, production-packaged series.
              Every document linked, scored, and coherent.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            {capability('🧠', 'Narrative Intelligence', 'Analyses story structure in real time — arc logic, character pressure, dramatic tension. CI + GP scoring on every document. Identifies gaps and risks before they cost money.')}
            {capability('🚀', 'Autonomous Pipeline', 'Auto-Run develops a project from idea to complete series package without human intervention. 418 steps across 9 stages. Overnight.')}
            {capability('📋', 'Concept & Format Intelligence', 'Generates detailed concept briefs, format rules, production constraints, and market positioning — not just scripts. Every production parameter defined and enforced.')}
            {capability('📖', 'Complete Series Bible', 'Season arc, episode grid, character bible, episode beats, season script. The full development package — every document linked, scored, and ready to go.')}
            {capability('📊', 'Greenlight Intelligence', 'Confidence Index scoring, Greenlight Probability, narrative risk flags, and repair recommendations. Know before you commit.')}
            {capability('🌍', 'Slate & Market Intelligence', 'Cross-project intelligence across your entire slate. Market trend analysis, co-production planning, buyer CRM, festival calendar, incentive finder.')}
          </div>
        </div>
      </section>

      {/* ── 4. PROOF — CONCEPT BRIEF ────────────────────────────── */}
      <section style={{ padding: '6rem 2rem', maxWidth: 960, margin: '0 auto' }} className="print:py-12 print:break-before-page">
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>In Practice</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 600, lineHeight: 1.2, marginBottom: '1rem' }}>
            A complete series. <span style={{ color: gold }}>One session.</span>
          </h2>
          <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.7, maxWidth: 600, margin: '0 auto' }}>
            <em>My Fiancé Paid the Ransom</em> — a 60-episode vertical thriller-romance — was developed
            end-to-end by IFFY. Not just scripts. The full production package.
          </p>
        </div>

        {/* Concept Brief sample */}
        <div style={{ background: bgCard, border: `1px solid rgba(196,154,61,0.2)`, borderRadius: 12, padding: '2rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: gold }} />
            <span style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Concept Brief — IFFY Output</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            {[
              ['Logline', 'A wealthy bride-to-be is kidnapped before her wedding, only to discover her captor is actually protecting her from those who orchestrated her abduction — including her fiancé — leading to an unexpected and dangerous romance.'],
              ['Genre', 'Vertical-Drama · Thriller-Romance · Suspense\nTarget: Adults 25–55. "The Night Agent meets The Firm."'],
              ['Tone & Style', 'High-heat thriller-romance. Relentless cliffhangers. Active understatement — loaded glances and sharp dialogue convey danger without sacrificing sophistication.'],
              ['Story Engine', 'Characters trapped in escalating constraints with diminishing options. Small pressures compound until a threshold breaks, forcing desperate choices and revealing true motivations.'],
            ].map(([title, body]) => (
              <div key={title as string}>
                <div style={{ color: gold, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.4rem' }}>{title}</div>
                <div style={{ color: fgMuted, fontSize: '0.82rem', lineHeight: 1.65, whiteSpace: 'pre-line' }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Format Rules sample */}
        <div style={{ background: bgCard, border: `1px solid rgba(196,154,61,0.2)`, borderRadius: 12, padding: '2rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: gold }} />
            <span style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Format Rules — IFFY Output</span>
          </div>
          <p style={{ color: fgMuted, fontSize: '0.82rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            IFFY generates binding production constraints alongside the creative material — enforcing format,
            budget discipline, and platform optimisation automatically.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {rule('1.', 'Frame & Delivery', '9:16 vertical aspect ratio. Mobile-first. Designed for TikTok, YouTube Shorts, ReelShort, FlexTV. 60 canonical episodes.')}
            {rule('2.', 'Episode Duration', '120–180 seconds per episode. Hard minimum 120s. Hard maximum 180s. Ideal midpoint: 150 seconds.')}
            {rule('3.', 'Beat Cadence', '8–12 distinct beats per episode. Scroll-stopping hook within first 3–10 seconds. Every episode ends on a micro-cliffhanger. No exceptions.')}
            {rule('4.', 'Visual Grammar', '60–70% close-up or MCU. Horizontal pans forbidden. Letterboxing forbidden. Single-subject framing preferred.')}
            {rule('5.', 'Dialogue Rules', 'Max 3 lines uninterrupted dialogue before a visual cut. Subtext over exposition. Show, don\'t tell.')}
            {rule('6.', 'Budget Discipline', 'Micro-to-low budget band. Max 3 speaking roles per episode. Max 2 standing locations. No crowd scenes. No VFX.')}
          </div>
        </div>

        {/* Document suite */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {[
            ['Idea Doc', 'The original creative kernel — story, world, voice, hook.'],
            ['Concept Brief', '16,000+ word development document. Logline, premise, genre, tone, story engine, themes, world rules, characters.'],
            ['Format Rules', 'Binding production constraints — frame, duration, beats, visual grammar, dialogue, budget.'],
            ['Season Arc', 'Full story spine across all 60 episodes — pressure map, character arcs, resolution logic.'],
            ['Character Bible', 'Principal character documentation — voice, motivation, arc, relationships.'],
            ['Episode Grid', '60 episodes mapped with premise, hook, cliffhanger, arc position.'],
            ['Episode Beats', 'Detailed beat structure for every single episode.'],
            ['Season Script', '60 full screenplay episodes — dialogue, action lines, scene structure.'],
          ].map(([title, desc]) => (
            <div key={title as string} style={{ background: bgCardAlt, borderRadius: 10, padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: gold, flexShrink: 0 }} />
                <span style={{ color: fg, fontSize: '0.85rem', fontWeight: 600 }}>{title}</span>
              </div>
              <p style={{ color: fgMuted, fontSize: '0.78rem', lineHeight: 1.55, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. THE OPPORTUNITY ──────────────────────────────────── */}
      <section style={{ padding: '6rem 2rem', background: bgCardAlt }} className="print:py-12 print:break-before-page">
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>The Opportunity</div>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 600, lineHeight: 1.2, marginBottom: '1.5rem' }}>
            The content arms race<br /><span style={{ color: gold }}>demands new infrastructure.</span>
          </h2>
          <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 680, margin: '0 auto 3rem' }}>
            Streaming platforms need exponentially more content than the traditional development pipeline
            can supply. The bottleneck isn't talent — it's the process itself. IFFY removes that bottleneck.
            The studio or streamer that moves first has a structural advantage.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', textAlign: 'left' }}>
            {[
              { icon: '📱', title: 'Vertical Drama', body: 'The fastest-growing format globally. Short-form mobile-first serialised drama is consuming billions of viewing hours. IFFY was built for this format from day one — with format rule enforcement and platform-specific production constraints built in.' },
              { icon: '🌍', title: 'International Co-Production', body: 'IFFY creates a common development language for cross-border projects. Series bibles, character documentation, format rules, and scripts in a format any partner anywhere can use — immediately.' },
              { icon: '🏗️', title: 'Pipeline Infrastructure', body: 'Not a tool — an operating system. Every major studio, streamer, and production company will need this infrastructure. The question is who builds it first and who owns the standard.' },
            ].map(({ icon, title, body }) => (
              <div key={title} style={{ background: bgCard, borderRadius: 10, padding: '1.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{icon}</div>
                <div style={{ color: fg, fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{title}</div>
                <div style={{ color: fgMuted, fontSize: '0.82rem', lineHeight: 1.6 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. THE PARTNERSHIP ──────────────────────────────────── */}
      <section style={{ padding: '6rem 2rem', maxWidth: 800, margin: '0 auto', textAlign: 'center' }} className="print:py-12 print:break-before-page">
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>The Partnership</div>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 600, lineHeight: 1.2, marginBottom: '1.5rem' }}>
          Built for someone who understands<br /><span style={{ color: gold }}>the full pipeline.</span>
        </h2>
        <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 620, margin: '0 auto 3rem' }}>
          IFFY is seeking a strategic Chairman with deep relationships across content, distribution,
          and the creative industries — someone who can help shape the company's direction
          and open doors to the partners who will define the future of content at scale.
        </p>
        <div style={{ marginBottom: '3rem' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>Strategic partner landscape</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
            {['BBC Studios', 'ITV Studios', 'Channel 4', 'Sky Studios', 'Netflix UK', 'Amazon MGM', 'Apple TV+', 'FilmFour', 'BFI', 'NFTS', 'ReelShort', 'FlexTV'].map(name => (
              <div key={name} style={{ border: `1px solid rgba(196,154,61,0.2)`, borderRadius: 8, padding: '0.6rem 1.2rem', color: fg, fontSize: '0.82rem', letterSpacing: '0.04em', background: 'rgba(196,154,61,0.05)' }}>{name}</div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: `1px solid rgba(196,154,61,0.2)`, paddingTop: '2.5rem' }}>
          <p style={{ color: fgMuted, fontSize: '0.9rem', lineHeight: 1.8, fontStyle: 'italic', marginBottom: '2rem' }}>
            "Every major studio is going to need a system like this.<br />
            The question is whether British companies build it first."
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
            <img src={iffyLogo} alt="IFFY" style={{ height: 28, width: 28, opacity: 0.7 }} />
            <div>
              <div style={{ color: fg, fontSize: '0.9rem', fontWeight: 600 }}>Sebastian Street</div>
              <div style={{ color: fgMuted, fontSize: '0.75rem' }}>Founder, IFFY Film Intelligence</div>
            </div>
          </div>
        </div>
      </section>

      <footer style={{ padding: '2rem', textAlign: 'center', borderTop: `1px solid rgba(255,255,255,0.06)` }} className="print:hidden">
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.1em' }}>IFFY · Film Intelligence · Confidential</div>
      </footer>

    </div>
  );
}
