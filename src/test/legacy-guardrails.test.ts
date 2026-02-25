/**
 * Legacy Guardrails — Prevent deprecated UI entrypoints from reappearing.
 * These tests fail if legacy buttons, routes, or imports are re-introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const readSrc = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8');

/* ── A) Deprecated route assertions ── */

describe('Legacy routes are removed or redirect', () => {
  const appSource = readSrc('App.tsx');

  it('/quick-review uses ReviewRedirect (preserves projectId)', () => {
    expect(appSource).toContain('path="/quick-review"');
    expect(appSource).toContain('ReviewRedirect');
    // Must NOT render old QuickReview/DeepReview page components
    expect(appSource).not.toMatch(/<QuickReview\s*\/>/);
  });

  it('/deep-review uses ReviewRedirect (preserves projectId)', () => {
    expect(appSource).toContain('path="/deep-review"');
    expect(appSource).toContain('ReviewRedirect');
    expect(appSource).not.toMatch(/<DeepReview\s*\/>/);
  });

  it('ReviewRedirect redirects to canonical analysis when projectId present', () => {
    // ReviewRedirect must contain the canonical analysis path
    expect(appSource).toContain('/script?drawer=open&drawerTab=analysis');
  });

  it('ReviewRedirect falls back to /dashboard without projectId', () => {
    expect(appSource).toContain('Navigate to="/dashboard"');
  });

  it('/ai-trailer redirects to canonical trailer', () => {
    expect(appSource).toContain('path="/projects/:id/ai-trailer"');
    expect(appSource).toContain('TrailerRedirect');
    expect(appSource).not.toMatch(/<AiTrailerBuilder\s*\/>/);
  });

  it('does not lazy-import AiTrailerBuilder', () => {
    expect(appSource).not.toContain('import("./pages/AiTrailerBuilder")');
  });
});

/* ── B) Legacy labels absent from key UI files ── */

describe('Legacy labels removed from UI', () => {
  it('ScriptIngestCard has no "Quick Review" or "Deep Review" buttons', () => {
    const source = readSrc('components/dashboard/ScriptIngestCard.tsx');
    expect(source).not.toContain('Quick Review');
    expect(source).not.toContain('Deep Review');
    expect(source).not.toContain('/quick-review');
    expect(source).not.toContain('/deep-review');
  });

  it('TrailerHub has no Legacy Blueprint tab', () => {
    const source = readSrc('pages/TrailerHub.tsx');
    expect(source).not.toContain('LegacyBlueprintTab');
    expect(source).not.toContain('v1 Blueprints');
  });

  it('TrailerPipeline has no Legacy Blueprint tab', () => {
    const source = readSrc('pages/TrailerPipeline.tsx');
    expect(source).not.toContain('<LegacyBlueprintTab');
    expect(source).not.toContain('Legacy (Blueprint v1)');
  });

  it('VisualProductionPanel has no AI Trailer Factory button or /ai-trailer links', () => {
    const source = readSrc('components/devengine/VisualProductionPanel.tsx');
    // The label "AI Trailer Factory" and direct /ai-trailer route must not appear as user-facing text
    expect(source).not.toMatch(/>\s*AI Trailer Factory\s*</);
    expect(source).not.toMatch(/\/ai-trailer['")`]/);
  });

  it('Header has no Quick/Deep Review nav entries', () => {
    const source = readSrc('components/Header.tsx');
    expect(source).not.toContain('Quick Review');
    expect(source).not.toContain('Deep Review');
    expect(source).not.toContain('/quick-review');
    expect(source).not.toContain('/deep-review');
  });
});

/* ── C) DeepReviewModal is unused ── */

describe('Unused legacy components', () => {
  it('DeepReviewModal is not imported anywhere except its own file', () => {
    // Check common UI files that might import it
    const filesToCheck = [
      'App.tsx',
      'components/Header.tsx',
      'components/dashboard/ScriptIngestCard.tsx',
      'pages/ProjectDetail.tsx',
    ];
    for (const f of filesToCheck) {
      if (existsSync(resolve(__dirname, '..', f))) {
        const source = readSrc(f);
        expect(source).not.toContain('DeepReviewModal');
      }
    }
  });
});

/* ── D) Canonical entrypoints exist ── */

describe('Canonical entrypoints are present', () => {
  const appSource = readSrc('App.tsx');

  it('canonical /projects/:id/trailer route exists', () => {
    expect(appSource).toContain('path="/projects/:id/trailer"');
  });

  it('canonical /projects/:id/script route exists', () => {
    expect(appSource).toContain('path="/projects/:id/script"');
  });

  it('canonical /projects/:id/visual-dev route exists', () => {
    expect(appSource).toContain('path="/projects/:id/visual-dev"');
  });

  it('canonical analysis is reachable via workspace', () => {
    // ScriptIngestCard should navigate to canonical analysis
    const source = readSrc('components/dashboard/ScriptIngestCard.tsx');
    expect(source).toContain('drawer=open&drawerTab=analysis');
  });
});
