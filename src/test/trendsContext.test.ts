/**
 * Unit tests for modalityToTrendsProductionTypeFilter logic.
 * Tests the FE mirror of the shared backend helper.
 */
import { describe, it, expect } from 'vitest';

// Mirror of the backend helper for FE use
function modalityToTrendsProductionTypeFilter(
  modality: string | null,
  fallbackTypeLabel?: string | null,
): string | null {
  if (modality === 'animation') return 'animation';
  if (fallbackTypeLabel) return fallbackTypeLabel;
  return null;
}

describe('modalityToTrendsProductionTypeFilter', () => {
  it('animation modality always returns "animation"', () => {
    expect(modalityToTrendsProductionTypeFilter('animation', 'film')).toBe('animation');
    expect(modalityToTrendsProductionTypeFilter('animation', null)).toBe('animation');
    expect(modalityToTrendsProductionTypeFilter('animation', 'tv-series')).toBe('animation');
  });

  it('live_action returns fallbackTypeLabel when provided', () => {
    expect(modalityToTrendsProductionTypeFilter('live_action', 'film')).toBe('film');
    expect(modalityToTrendsProductionTypeFilter('live_action', 'documentary')).toBe('documentary');
  });

  it('hybrid returns fallbackTypeLabel when provided', () => {
    expect(modalityToTrendsProductionTypeFilter('hybrid', 'film')).toBe('film');
    expect(modalityToTrendsProductionTypeFilter('hybrid', 'tv-series')).toBe('tv-series');
  });

  it('null modality with fallback returns fallback', () => {
    expect(modalityToTrendsProductionTypeFilter(null, 'film')).toBe('film');
  });

  it('null modality without fallback returns null', () => {
    expect(modalityToTrendsProductionTypeFilter(null, null)).toBeNull();
    expect(modalityToTrendsProductionTypeFilter(null)).toBeNull();
  });

  it('live_action without fallback returns null', () => {
    expect(modalityToTrendsProductionTypeFilter('live_action', null)).toBeNull();
    expect(modalityToTrendsProductionTypeFilter('live_action')).toBeNull();
  });
});
