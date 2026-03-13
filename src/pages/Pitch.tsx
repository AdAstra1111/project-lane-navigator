/**
 * Pitch.tsx — Bespoke investor/partner presentation for IFFY.
 * Public route (/pitch) — no authentication required.
 * Optimised for: screen presentation + print (leave-behind).
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

const capability = (icon: string, title: string, desc: string) => (
  <div style={{ background: bgCard, border: `1px solid rgba(196,154,61,0.15)`, borderRadius: 12, padding: '1.75rem' }}>
    <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{icon}</div>
    <div style={{ color: fg, fontFamily: 'Fraunces, Georgia, serif', fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</div>
    <div style={{ color: fgMuted, fontSize: '0.85rem', lineHeight: 1.6 }}>{desc}</div>
  </div>
);

const partner = (name: string) => (
  <div style={{
    border: `1px solid rgba(196,154,61,0.2)`,
    borderRadius: 8,
    padding: '0.6rem 1.2rem',
    color: fg,
    fontSize: '0.82rem',
    letterSpacing: '0.04em',
    background: 'rgba(196,154,61,0.05)',
  }}>{name}</div>
);

export default function Pitch() {
  return (
    <div style={{ background: bg, color: fg, fontFamily: 'DM Sans, system-ui, sans-serif', minHeight: '100vh' }}>

      {/* ── 1. HERO ─────────────────────────────────────────────── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '4rem 2rem',
        position: 'relative',
        overflow: 'hidden',
      }}
        className="print:min-h-0 print:py-16"
      >
        {/* Background gradient */}
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
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
          fontWeight: 700,
          lineHeight: 1.1,
          maxWidth: 760,
          marginBottom: '1.5rem',
          letterSpacing: '-0.01em',
        }}>
          From Inception<br />
          <span style={{ color: gold }}>to Legacy.</span>
        </h1>

        <p style={{ color: fgMuted, fontSize: '1.1rem', maxWidth: 520, lineHeight: 1.7, marginBottom: '3rem' }}>
          The intelligence layer that transforms how film and television
          is developed — from idea to greenlight, in hours, not months.
        </p>

        <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {stat('60', 'Episodes scripted overnight')}
          {stat('12×', 'Faster than a writers\' room')}
          {stat('£0', 'Development waste')}
        </div>
      </section>

      {/* ── 2. THE PROBLEM ──────────────────────────────────────── */}
      <section style={{
        padding: '6rem 2rem',
        maxWidth: 900,
        margin: '0 auto',
        textAlign: 'center',
      }}
        className="print:py-12 print:break-before-page"
      >
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          The Problem
        </div>

        <h2 style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 'clamp(1.8rem, 4vw, 3rem)',
          fontWeight: 600,
          lineHeight: 1.2,
          marginBottom: '2rem',
        }}>
          The most expensive stage of filmmaking<br />
          <span style={{ color: gold }}>produces the least.</span>
        </h2>

        <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 680, margin: '0 auto 3rem' }}>
          Development is where the industry haemorrhages money. Brilliant projects die
          not because of talent, but because of time, cost, and the chaos of the process.
          The average studio spends 18 months and hundreds of thousands of pounds
          to reach greenlight — and 9 in 10 projects never get there.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1.5rem',
          textAlign: 'center',
        }}>
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
      <section style={{
        padding: '6rem 2rem',
        background: bgCardAlt,
      }}
        className="print:py-12 print:break-before-page"
      >
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
              The Solution
            </div>
            <h2 style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
              fontWeight: 600,
              lineHeight: 1.2,
              maxWidth: 700,
              margin: '0 auto 1.5rem',
            }}>
              IFFY is the operating system<br />
              <span style={{ color: gold }}>for content development.</span>
            </h2>
            <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
              Not a script generator. A complete intelligence layer — from the first idea
              to greenlight, production handoff, and beyond. Every stage. Every decision.
              One system.
            </p>
          </div>

          {/* Capability categories */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            {capability(
              '🧠',
              'Narrative Intelligence',
              'Analyses story structure in real time — arc logic, character pressure, dramatic tension, narrative health. Identifies gaps and risks before they cost money. CI + GP scoring on every document, every version.'
            )}
            {capability(
              '🚀',
              'Autonomous Development Pipeline',
              'Auto-Run: a fully autonomous pipeline that develops a project from idea to complete series bible and screenplay — without human intervention. 418 steps. 9 stages. Overnight.'
            )}
            {capability(
              '📖',
              'Complete Series Bible',
              'Season arc, episode grid, character bible, episode beats, season script — the full development package. Every document linked, scored, and coherent. What a room takes months to build, IFFY delivers in hours.'
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            {capability(
              '📊',
              'Greenlight Intelligence',
              'Confidence Index scoring, Greenlight Probability, narrative risk flags, and repair recommendations. Data-driven decisions at every stage — not gut instinct alone. Know before you commit.'
            )}
            {capability(
              '🌍',
              'Slate & Market Intelligence',
              'Cross-project intelligence across your entire slate. Market trend analysis, audience targeting, co-production planning, and international format intelligence. See your portfolio, not just your project.'
            )}
            {capability(
              '💼',
              'Production & Distribution Tools',
              'Buyer CRM, festival calendar, incentive finder, co-production cashflow modelling, production calendar. The full pipeline from development through to distribution — in one place.'
            )}
          </div>
        </div>
      </section>

      {/* ── 4. PROOF ────────────────────────────────────────────── */}
      <section style={{
        padding: '6rem 2rem',
        maxWidth: 960,
        margin: '0 auto',
      }}
        className="print:py-12 print:break-before-page"
      >
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            In Practice
          </div>
          <h2 style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
            fontWeight: 600,
            lineHeight: 1.2,
            marginBottom: '1rem',
          }}>
            A complete series. <span style={{ color: gold }}>One session.</span>
          </h2>
          <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.7, maxWidth: 580, margin: '0 auto' }}>
            <em>My Fiancé Paid the Ransom</em> — a 60-episode vertical drama — was developed
            end-to-end using IFFY. What a writers' room would spend months building,
            IFFY delivered overnight.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
          {[
            ['Season Arc', 'Complete story spine across all 60 episodes — pressure system, character arcs, resolution logic'],
            ['Episode Grid', '60 episodes mapped with titles, micro-beats, and cliffhangers'],
            ['Character Bible', 'Full documentation for every principal character — voice, motivation, arc'],
            ['Season Script', '60 full screenplay episodes — dialogue, action lines, scene structure'],
          ].map(([title, desc]) => (
            <div key={title} style={{
              background: bgCard,
              borderRadius: 10,
              padding: '1.5rem',
              border: `1px solid rgba(196,154,61,0.2)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: gold, flexShrink: 0 }} />
                <span style={{ color: fg, fontSize: '0.9rem', fontWeight: 600 }}>{title}</span>
              </div>
              <p style={{ color: fgMuted, fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Sample script excerpt visual */}
        <div style={{
          background: bgCard,
          border: `1px solid rgba(196,154,61,0.15)`,
          borderRadius: 12,
          padding: '2rem',
          fontFamily: 'Courier New, Courier, monospace',
          fontSize: '0.78rem',
          lineHeight: 1.8,
          color: fgMuted,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 3,
            background: `linear-gradient(90deg, ${gold}, ${goldLight}, ${gold})`,
            opacity: 0.6,
          }} />
          <div style={{ color: fgMuted, fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1rem', opacity: 0.6 }}>
            Sample — My Fiancé Paid the Ransom / Episode 01
          </div>
          <div style={{ color: fg, fontWeight: 700, marginBottom: '0.25rem' }}>## EPISODE 01: THE CALL THAT CHANGES EVERYTHING</div>
          <div style={{ color: fgMuted, fontStyle: 'italic', marginBottom: '1rem' }}>*Duration: 120–180 seconds*</div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ color: fg, opacity: 0.9 }}>COLD OPEN</div>
            <div style={{ paddingLeft: '1.5rem', marginTop: '0.25rem' }}>
              A phone screen lights up in the dark. 3:14 AM. Unknown number.<br />
              AMIRA (28) stares at it — she hasn't slept. She already knows.
            </div>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ color: fg, textAlign: 'center', letterSpacing: '0.1em' }}>AMIRA</div>
            <div style={{ paddingLeft: '3rem' }}>(barely breathing)</div>
            <div style={{ paddingLeft: '3rem' }}>Tell me he's alive.</div>
          </div>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
            background: `linear-gradient(transparent, ${bgCard})`,
          }} />
        </div>
      </section>

      {/* ── 5. THE MOMENT ───────────────────────────────────────── */}
      <section style={{
        padding: '6rem 2rem',
        background: bgCardAlt,
      }}
        className="print:py-12 print:break-before-page"
      >
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            The Opportunity
          </div>
          <h2 style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
            fontWeight: 600,
            lineHeight: 1.2,
            marginBottom: '1.5rem',
          }}>
            The content arms race<br />
            <span style={{ color: gold }}>demands a new infrastructure.</span>
          </h2>

          <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 680, margin: '0 auto 3rem' }}>
            Streaming platforms need exponentially more content than the traditional
            development pipeline can supply. The bottleneck isn't talent — it's
            the development process itself. IFFY removes that bottleneck.
            The studio or streamer that moves first has a structural advantage.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', textAlign: 'left' }}>
            {[
              {
                icon: '📱',
                title: 'Vertical Drama',
                body: 'The fastest-growing format globally. Short-form, mobile-first serialised drama is consuming billions of viewing hours. IFFY was built for this format from day one.',
              },
              {
                icon: '🌍',
                title: 'International Co-Production',
                body: 'IFFY creates a common development language for cross-border projects. Series bibles, character documentation, and scripts in a format any partner anywhere can use.',
              },
              {
                icon: '🏗️',
                title: 'Pipeline Infrastructure',
                body: 'Not just a tool — an operating system for content development. Every major studio, streamer, and production company will need this infrastructure.',
              },
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
      <section style={{
        padding: '6rem 2rem',
        maxWidth: 800,
        margin: '0 auto',
        textAlign: 'center',
      }}
        className="print:py-12 print:break-before-page"
      >
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          The Partnership
        </div>

        <h2 style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
          fontWeight: 600,
          lineHeight: 1.2,
          marginBottom: '1.5rem',
        }}>
          Built for someone who understands<br />
          <span style={{ color: gold }}>the full pipeline.</span>
        </h2>

        <p style={{ color: fgMuted, fontSize: '1rem', lineHeight: 1.8, maxWidth: 620, margin: '0 auto 3rem' }}>
          IFFY is seeking a strategic Chairman with deep relationships across
          content, distribution, and the creative industries — someone who can
          help shape the company's direction and open doors to the partners
          who will define the future of content at scale.
        </p>

        <div style={{ marginBottom: '3rem' }}>
          <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
            Strategic partner landscape
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
            {[
              'BBC Studios', 'ITV Studios', 'Channel 4', 'Sky Studios',
              'Netflix UK', 'Amazon MGM', 'Apple TV+', 'ITVX',
              'FilmFour', 'BFI', 'NFTS', 'VFX Partners',
            ].map(partner)}
          </div>
        </div>

        <div style={{
          borderTop: `1px solid rgba(196,154,61,0.2)`,
          paddingTop: '2.5rem',
        }}>
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

      {/* ── FOOTER ──────────────────────────────────────────────── */}
      <footer style={{
        padding: '2rem',
        textAlign: 'center',
        borderTop: `1px solid rgba(255,255,255,0.06)`,
      }}
        className="print:hidden"
      >
        <div style={{ color: fgMuted, fontSize: '0.7rem', letterSpacing: '0.1em' }}>
          IFFY · Film Intelligence · Confidential
        </div>
      </footer>

    </div>
  );
}
