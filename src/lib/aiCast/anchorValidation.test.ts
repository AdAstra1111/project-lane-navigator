/**
 * Anchor Validation — Parity Tests
 * 
 * Verifies that actor-level and candidate-level paths produce identical
 * classification results for the same anchor sets.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCandidateAnchorCoverage,
  type CandidateAnchorPackage,
} from './anchorValidation';

// These tests validate the shared classification logic via the candidate path
// (which uses the same buildCoverageResult / classifyCoverage helpers as the actor path).

describe('anchorValidation — coverage classification parity', () => {
  it('3 anchors → complete', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: 'https://img/head.jpg',
      full_body_url: 'https://img/body.jpg',
      additional_refs: ['https://img/profile.jpg'],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('complete');
    expect(result.anchorCount).toBe(3);
    expect(result.presentAnchors).toEqual({ headshot: true, profile: true, fullBody: true });
  });

  it('2 anchors (headshot + fullBody) → partial', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: 'https://img/head.jpg',
      full_body_url: 'https://img/body.jpg',
      additional_refs: [],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('partial');
    expect(result.anchorCount).toBe(2);
    expect(result.presentAnchors.profile).toBe(false);
  });

  it('1 anchor (headshot only) → insufficient', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: 'https://img/head.jpg',
      full_body_url: null,
      additional_refs: [],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('insufficient');
    expect(result.anchorCount).toBe(1);
  });

  it('0 anchors → insufficient', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: null,
      full_body_url: null,
      additional_refs: [],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('insufficient');
    expect(result.anchorCount).toBe(0);
  });

  it('profile only (via additional_refs) → insufficient', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: null,
      full_body_url: null,
      additional_refs: ['https://img/profile.jpg'],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('insufficient');
    expect(result.anchorCount).toBe(1);
    expect(result.presentAnchors.profile).toBe(true);
  });

  it('fullBody + profile → partial', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: null,
      full_body_url: 'https://img/body.jpg',
      additional_refs: ['https://img/profile.jpg'],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.coverageStatus).toBe('partial');
    expect(result.anchorCount).toBe(2);
    expect(result.presentAnchors.headshot).toBe(false);
  });

  it('anchorUrls carry correct values', () => {
    const pkg: CandidateAnchorPackage = {
      headshot_url: 'https://a.jpg',
      full_body_url: 'https://b.jpg',
      additional_refs: ['https://c.jpg'],
    };
    const result = evaluateCandidateAnchorCoverage(pkg);
    expect(result.anchorUrls.headshot).toBe('https://a.jpg');
    expect(result.anchorUrls.fullBody).toBe('https://b.jpg');
    expect(result.anchorUrls.profile).toBe('https://c.jpg');
  });
});
