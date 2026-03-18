/**
 * Look Book Layout Schema — Single source of truth for viewer + PDF export.
 * Each slide is a deterministic frame at 1920×1080.
 */

export type SlideType =
  | 'cover'
  | 'overview'
  | 'world'
  | 'characters'
  | 'themes'
  | 'visual_language'
  | 'story_engine'
  | 'comparables'
  | 'creative_statement'
  | 'closing';

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

export interface SlideContent {
  type: SlideType;
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
  /** Image caption */
  imageCaption?: string;
  /** Character cards for character slide */
  characters?: Array<{
    name: string;
    role: string;
    description: string;
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
}

export interface LookBookData {
  projectId: string;
  projectTitle: string;
  /** Visual identity derived from project tone/genre */
  identity: LookBookVisualIdentity;
  /** Ordered slides */
  slides: SlideContent[];
  /** Metadata */
  generatedAt: string;
  writerCredit: string;
  companyName: string;
  companyLogoUrl: string | null;
}

/** Slide dimensions — fixed resolution, scaled to fit */
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const SLIDE_ASPECT = SLIDE_WIDTH / SLIDE_HEIGHT;
