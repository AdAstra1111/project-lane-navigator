import { describe, it, expect } from 'vitest';
import {
  classifyVerticalCompliance,
  classifyVerticalDramaForBrowsing,
} from '../verticalCompliance';

const VD_FORMAT = 'vertical-drama';
const VD_LANE = 'vertical_drama';

describe('classifyVerticalCompliance', () => {
  it('classifies 1:1 square as square, not portrait', () => {
    const result = classifyVerticalCompliance(
      { width: 1024, height: 1024 },
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('square');
    expect(result.eligibleForWinnerSelection).toBe(false);
  });

  it('classifies 3:4 as portrait_only, not strict vertical', () => {
    const result = classifyVerticalCompliance(
      { width: 896, height: 1152 }, // ratio ~1.29
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('portrait_only');
    expect(result.eligibleForWinnerSelection).toBe(false);
  });

  it('classifies 2:3 as portrait_only, not strict vertical', () => {
    const result = classifyVerticalCompliance(
      { width: 832, height: 1248 }, // ratio ~1.5
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('portrait_only');
    expect(result.eligibleForWinnerSelection).toBe(false);
  });

  it('classifies 9:16 as strict_vertical_compliant', () => {
    const result = classifyVerticalCompliance(
      { width: 720, height: 1280 }, // ratio ~1.78
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('strict_vertical_compliant');
    expect(result.eligibleForWinnerSelection).toBe(true);
    expect(result.dimensionSource).toBe('measured');
  });

  it('classifies null dims as unknown_unmeasured', () => {
    const result = classifyVerticalCompliance(
      { width: null, height: null },
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('unknown_unmeasured');
    expect(result.eligibleForWinnerSelection).toBe(false);
  });

  it('classifies landscape as non_compliant', () => {
    const result = classifyVerticalCompliance(
      { width: 1280, height: 720 },
      'wide', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('non_compliant');
    expect(result.eligibleForWinnerSelection).toBe(false);
  });

  it('non-VD project treats everything as compliant', () => {
    const result = classifyVerticalCompliance(
      { width: 1280, height: 720 },
      'wide', 'film', 'prestige-awards',
    );
    expect(result.level).toBe('strict_vertical_compliant');
    expect(result.eligibleForWinnerSelection).toBe(true);
  });

  it('identity exception 1:1 headshot is compliant in identity slot', () => {
    const result = classifyVerticalCompliance(
      { width: 1024, height: 1024 },
      'identity_headshot', VD_FORMAT, VD_LANE,
    );
    expect(result.level).toBe('strict_vertical_compliant');
    expect(result.eligibleForWinnerSelection).toBe(true);
    expect(result.isIdentityException).toBe(true);
  });
});

describe('classifyVerticalDramaForBrowsing', () => {
  it('square is labeled □ VD', () => {
    const result = classifyVerticalDramaForBrowsing({ width: 1024, height: 1024 });
    expect(result.level).toBe('square');
    expect(result.label).toBe('□ VD');
    expect(result.compliant).toBe(false);
  });

  it('null dims is unknown_unmeasured', () => {
    const result = classifyVerticalDramaForBrowsing({ width: null, height: null });
    expect(result.level).toBe('unknown_unmeasured');
    expect(result.compliant).toBe(false);
  });

  it('9:16 is strict compliant', () => {
    const result = classifyVerticalDramaForBrowsing({ width: 720, height: 1280 });
    expect(result.level).toBe('strict_vertical_compliant');
    expect(result.compliant).toBe(true);
  });

  it('3:4 is portrait_only', () => {
    const result = classifyVerticalDramaForBrowsing({ width: 896, height: 1152 });
    expect(result.level).toBe('portrait_only');
    expect(result.compliant).toBe(false);
  });
});
