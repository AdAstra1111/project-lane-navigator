/**
 * Look Book Layout Schema — Single source of truth for viewer + PDF export.
 * Supports landscape (1920×1080) and portrait (1080×1920) deck formats.
 */

export type SlideType =
  | 'cover'
  | 'overview'
  | 'world'
  | 'characters'
  | 'themes'
  | 'visual_language'
  | 'story_engine'
  | 'key_moments'
  | 'comparables'
  | 'creative_statement'
  | 'closing';

export type DeckFormat = 'landscape' | 'portrait';

export interface LookBookColorSystem {
  /** Primary background — deep, immersive */
  bg: string;
  /** Secondary background for cards/panels */
  bgSecondary: string;
  /** Primary text */
  text: string;
  /** Secondary/muted text */
  textMuted: string;
  /** Accent color — derived from genre/tone */
  accent: string;
  /** Accent at lower opacity for borders/subtle use */
  accentMuted: string;
  /** Gradient for dramatic backgrounds */
  gradientFrom: string;
  gradientTo: string;
}

export interface LookBookTypography {
  /** Title font family */
  titleFont: 'Fraunces' | 'Georgia' | 'Playfair Display';
  /** Body font family */
  bodyFont: 'DM Sans' | 'Inter' | 'Lato';
  /** Whether title should be uppercase */
  titleUppercase: boolean;
}

export interface LookBookVisualIdentity {
  colors: LookBookColorSystem;
  typography: LookBookTypography;
  /** Image treatment style */
  imageStyle: 'cinematic-warm' | 'cinematic-cold' | 'desaturated' | 'high-contrast' | 'vintage';
}

/** Debug provenance for a single image displayed in the deck */
export interface SlideImageProvenance {
  imageId: string;
  source: 'winner_primary' | 'active_non_primary' | 'candidate_fallback' | 'unresolved';
  complianceClass: string;
  actualWidth: number | null;
  actualHeight: number | null;
}

/** Canonical per-slide user decisions — scalable structure for editorial overrides */
export interface SlideUserDecisions {
  /** User-selected layout family override */
  layout_family?: string | null;
}

/** Rebuild result — structured truth reporting for automated rebuild */
export interface RebuildResult {
  totalSlots: number;
  resolvedSlots: number;
  unresolvedSlots: number;
  fallbackMatchCount?: number;
  generatedCount: number;
  compliantCount: number;
  rejectedNonCompliantCount: number;
  attachedWinnerCount: number;
  winnerIds: string[];
  unresolvedReasons: Array<{ slotKey: string; reason: string }>;
}

/** Cinematic slide composition mode */
export type SlideComposition = 
  | 'full_bleed_hero'        // image fills entire slide, text overlaid
  | 'split_cinematic'        // 50/50 or 60/40 image + text
  | 'text_over_atmosphere'   // prominent background image, text overlaid with scrim
  | 'montage_grid'           // image grid is the star, minimal text header
  | 'character_feature'      // portrait-led character display
  | 'editorial_panel'        // text-primary with supporting image panel
  | 'gradient_only';         // fallback when no imagery available

export interface SlideContent {
  type: SlideType;
  /** Stable slide identifier — deterministic, survives regeneration */
  slide_id: string;
  /** Canonical user decisions — persisted editorial overrides */
  user_decisions?: SlideUserDecisions;
  /** Slide title (e.g., "The World") */
  title?: string;
  /** Subtitle or section label */
  subtitle?: string;
  /** Main body text — markdown supported */
  body?: string;
  /** Secondary body / supporting text */
  bodySecondary?: string;
  /** Bullet points */
  bullets?: string[];
  /** Quote or pull-quote */
  quote?: string;
  /** Image URL (poster, mood, etc.) */
  imageUrl?: string;
  /** Multiple image URLs for gallery/grid slides */
  imageUrls?: string[];
  /** Image caption */
  imageCaption?: string;
  /** Character cards for character slide */
  characters?: Array<{
    name: string;
    role: string;
    description: string;
    imageUrl?: string;
  }>;
  /** Comparable titles */
  comparables?: Array<{
    title: string;
    reason: string;
  }>;
  /** Credit line */
  credit?: string;
  /** Company name */
  companyName?: string;
  /** Company logo URL */
  companyLogoUrl?: string;

  // ── Cinematic background layer ──
  /** Background image URL — full-bleed cinematic plate */
  backgroundImageUrl?: string;
  /** Resolved cinematic composition mode */
  composition?: SlideComposition;

  // ── Layout family metadata ──
  /** Resolved layout family key for this slide (from auto-resolver) */
  layoutFamily?: string;
  /** User-selected override family, if any — legacy compat, prefer user_decisions */
  layoutFamilyOverride?: string | null;
  /** Effective family = user_decisions.layout_family ?? override ?? resolved ?? default */
  layoutFamilyEffective?: string;
  /** Resolution reason / audit trail */
  layoutFamilyReason?: string;
  /** Override provenance */
  layoutFamilyOverrideSource?: 'user' | null;
  /** Slot assignments from the slot matcher */
  slotAssignments?: Array<{
    slotKey: string;
    expectedOrientation: string;
    intent: string;
    assignedUrl: string | null;
    assignedOrientation: string;
    orientationMatch: boolean;
  }>;
  /** Orientation summary of images on this slide */
  imageOrientationSummary?: {
    portrait: number;
    landscape: number;
    square: number;
    unknown: number;
    total: number;
  };

  // ── Debug provenance ──
  /** Debug provenance — image IDs used */
  _debug_image_ids?: string[];
  /** Debug provenance — per-image winner/compliance proof */
  _debug_provenance?: SlideImageProvenance[];
  /** Whether this slide has unresolved image slots */
  _has_unresolved?: boolean;
  /** Working-set source provenance — which slots came from provisional images */
  _workingSetSources?: Record<string, string>;
}

export interface LookBookData {
  projectId: string;
  projectTitle: string;
  /** Visual identity derived from project tone/genre */
  identity: LookBookVisualIdentity;
  /** Ordered slides */
  slides: SlideContent[];
  /** Deck format — portrait for vertical drama, landscape for everything else */
  deckFormat: DeckFormat;
  /** Metadata */
  generatedAt: string;
  writerCredit: string;
  companyName: string;
  companyLogoUrl: string | null;
  /** Unique build fingerprint — changes on every rebuild, proves fresh data */
  buildId?: string;
  /** Total resolved image references in this build */
  totalImageRefs?: number;
  /** Sorted list of all resolved image IDs — for change detection */
  resolvedImageIds?: string[];
}

/** Slide dimensions — landscape (default) */
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const SLIDE_ASPECT = SLIDE_WIDTH / SLIDE_HEIGHT;

/** Slide dimensions — portrait (vertical drama) */
export const SLIDE_WIDTH_PORTRAIT = 1080;
export const SLIDE_HEIGHT_PORTRAIT = 1920;

/** Resolve slide dimensions by deck format */
export function getSlideDimensions(format: DeckFormat): { width: number; height: number } {
  if (format === 'portrait') return { width: SLIDE_WIDTH_PORTRAIT, height: SLIDE_HEIGHT_PORTRAIT };
  return { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
}
