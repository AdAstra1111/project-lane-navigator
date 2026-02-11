import type { ProjectFormat } from '@/lib/types';

export const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Fantasy', 'Horror', 'Musical',
  'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western',
] as const;

export const BUDGET_RANGES = [
  { value: 'under-250k', label: 'Under $250K' },
  { value: '250k-1m', label: '$250K – $1M' },
  { value: '1m-5m', label: '$1M – $5M' },
  { value: '5m-15m', label: '$5M – $15M' },
  { value: '15m-50m', label: '$15M – $50M' },
  { value: '50m-plus', label: '$50M+' },
] as const;

export const TARGET_AUDIENCES = [
  { value: 'mass-market', label: 'Mass Market / Wide Release' },
  { value: 'young-adult', label: 'Young Adult (18–34)' },
  { value: 'adult-drama', label: 'Adult Drama Audience' },
  { value: 'genre-fans', label: 'Genre Fans' },
  { value: 'festival-arthouse', label: 'Festival / Arthouse' },
  { value: 'family', label: 'Family / All Ages' },
  { value: 'international', label: 'International / Multi-Territory' },
] as const;

export const TONES = [
  { value: 'commercial', label: 'Commercial / Accessible' },
  { value: 'elevated', label: 'Elevated / Prestige' },
  { value: 'dark-gritty', label: 'Dark / Gritty' },
  { value: 'light-comedic', label: 'Light / Comedic' },
  { value: 'arthouse', label: 'Arthouse / Experimental' },
  { value: 'provocative', label: 'Provocative / Topical' },
  { value: 'crowd-pleaser', label: 'Crowd-Pleaser' },
] as const;

// ─── Format-Specific Creative & Commercial Options ───

type LabelValue = { value: string; label: string };

export const MODE_GENRES: Record<ProjectFormat, string[]> = {
  film: [...GENRES],
  'tv-series': [...GENRES],
  'short-film': ['Drama', 'Comedy', 'Horror', 'Sci-Fi', 'Animation', 'Experimental', 'Documentary', 'Musical', 'Thriller', 'Romance'],
  documentary: ['Social Issue', 'Political', 'Nature / Environment', 'Historical', 'True Crime', 'Music / Arts', 'Sports', 'Science / Tech', 'Portrait / Biography', 'Investigative'],
  'documentary-series': ['Social Issue', 'Political', 'Nature / Environment', 'Historical', 'True Crime', 'Music / Arts', 'Sports', 'Science / Tech', 'Portrait / Biography', 'Investigative'],
  'digital-series': ['Comedy', 'Drama', 'Reality', 'Talk Show', 'Docuseries', 'Animation', 'Sketch', 'Gaming', 'Lifestyle', 'Educational'],
  commercial: ['Automotive', 'FMCG / CPG', 'Tech / Digital', 'Fashion / Beauty', 'Food & Beverage', 'Finance', 'Healthcare', 'Luxury', 'Telecoms', 'Sports / Fitness', 'Travel', 'Public Sector / NGO'],
  'branded-content': ['Lifestyle', 'Adventure', 'Culture', 'Social Impact', 'Music', 'Sports', 'Tech', 'Fashion', 'Food', 'Travel', 'Sustainability', 'Education'],
  'music-video': ['Pop', 'Hip-Hop / Rap', 'Rock', 'R&B / Soul', 'Electronic', 'Country', 'Latin', 'Indie', 'Classical', 'World Music'],
  'proof-of-concept': ['Drama', 'Sci-Fi', 'Horror', 'Fantasy', 'Action', 'Thriller', 'Animation', 'Comedy', 'Experimental'],
  hybrid: ['Transmedia', 'Interactive', 'Immersive', 'Mixed Reality', 'Documentary-Fiction', 'Cross-Platform', 'Experiential', 'Installation'],
  'vertical-drama': ['Romance', 'Drama', 'Thriller', 'Comedy', 'Fantasy', 'Horror', 'Action', 'Mystery', 'Revenge', 'Workplace'],
};

export const MODE_AUDIENCES: Record<ProjectFormat, LabelValue[]> = {
  film: [...TARGET_AUDIENCES],
  'tv-series': [...TARGET_AUDIENCES],
  'short-film': [
    { value: 'festival-programmers', label: 'Festival Programmers' },
    { value: 'industry', label: 'Industry / Talent Scouts' },
    { value: 'online-cinephile', label: 'Online Cinephiles' },
    { value: 'niche-community', label: 'Niche Community' },
    { value: 'general', label: 'General Audience' },
  ],
  documentary: [
    { value: 'broadcast-audience', label: 'Broadcast Audience' },
    { value: 'streamer-audience', label: 'Streamer Audience' },
    { value: 'festival-circuit', label: 'Festival / Theatrical' },
    { value: 'impact-campaign', label: 'Impact / Advocacy' },
    { value: 'educational', label: 'Educational / Institutional' },
    { value: 'international', label: 'International / Multi-Territory' },
  ],
  'documentary-series': [
    { value: 'broadcast-audience', label: 'Broadcast Audience' },
    { value: 'streamer-audience', label: 'Streamer Audience' },
    { value: 'impact-campaign', label: 'Impact / Advocacy' },
    { value: 'educational', label: 'Educational / Institutional' },
    { value: 'international', label: 'International / Multi-Territory' },
  ],
  'digital-series': [
    { value: 'gen-z', label: 'Gen Z (16–24)' },
    { value: 'millennial', label: 'Millennials (25–40)' },
    { value: 'niche-fandom', label: 'Niche Fandom' },
    { value: 'platform-native', label: 'Platform-Native Viewers' },
    { value: 'global-digital', label: 'Global Digital Audience' },
  ],
  commercial: [
    { value: 'brand-consumer', label: 'Brand Target Consumer' },
    { value: 'b2b', label: 'B2B Decision Makers' },
    { value: 'mass-reach', label: 'Mass Reach / TV Spot' },
    { value: 'social-first', label: 'Social-First Audience' },
    { value: 'premium-demo', label: 'Premium Demographic' },
  ],
  'branded-content': [
    { value: 'brand-loyalists', label: 'Brand Loyalists' },
    { value: 'cultural-audience', label: 'Cultural / Lifestyle Audience' },
    { value: 'social-audience', label: 'Social Media Audience' },
    { value: 'purpose-driven', label: 'Purpose-Driven Viewers' },
    { value: 'premium-demo', label: 'Premium Demographic' },
  ],
  'music-video': [
    { value: 'fans', label: 'Artist Fans' },
    { value: 'playlist-audience', label: 'Playlist / Discovery Audience' },
    { value: 'viral-social', label: 'Viral / Social Audience' },
    { value: 'music-industry', label: 'Music Industry / A&R' },
    { value: 'general-pop', label: 'General Pop Culture' },
  ],
  'proof-of-concept': [
    { value: 'investors', label: 'Investors / Financiers' },
    { value: 'festival-labs', label: 'Festival Labs / Incubators' },
    { value: 'industry', label: 'Industry Decision-Makers' },
    { value: 'platform-buyers', label: 'Platform / Studio Buyers' },
    { value: 'general', label: 'General Audience (test)' },
  ],
  hybrid: [
    { value: 'experiential', label: 'Experiential / Gallery Audience' },
    { value: 'digital-native', label: 'Digital-Native Audience' },
    { value: 'cross-platform', label: 'Cross-Platform Users' },
    { value: 'innovation-community', label: 'Innovation / Tech Community' },
    { value: 'general', label: 'General Audience' },
  ],
  'vertical-drama': [
    { value: 'gen-z', label: 'Gen Z (16–24)' },
    { value: 'millennial', label: 'Millennials (25–40)' },
    { value: 'mobile-first', label: 'Mobile-First Viewers' },
    { value: 'binge-watchers', label: 'Binge / Scroll Watchers' },
    { value: 'global-mobile', label: 'Global Mobile Audience' },
  ],
};

export const MODE_TONES: Record<ProjectFormat, LabelValue[]> = {
  film: [...TONES],
  'tv-series': [...TONES],
  'short-film': [
    { value: 'poetic', label: 'Poetic / Lyrical' },
    { value: 'raw', label: 'Raw / Intimate' },
    { value: 'experimental', label: 'Experimental' },
    { value: 'comedic', label: 'Comedic' },
    { value: 'genre', label: 'Genre-Driven' },
    { value: 'observational', label: 'Observational' },
  ],
  documentary: [
    { value: 'observational', label: 'Observational / Vérité' },
    { value: 'investigative', label: 'Investigative / Exposé' },
    { value: 'personal', label: 'Personal / First-Person' },
    { value: 'archival', label: 'Archival / Historical' },
    { value: 'activist', label: 'Activist / Advocacy' },
    { value: 'poetic', label: 'Poetic / Essayistic' },
    { value: 'entertaining', label: 'Entertaining / Accessible' },
  ],
  'documentary-series': [
    { value: 'observational', label: 'Observational / Vérité' },
    { value: 'investigative', label: 'Investigative / Exposé' },
    { value: 'archival', label: 'Archival / Historical' },
    { value: 'entertaining', label: 'Entertaining / Accessible' },
    { value: 'true-crime', label: 'True Crime / Procedural' },
    { value: 'anthology', label: 'Anthology / Episodic' },
  ],
  'digital-series': [
    { value: 'irreverent', label: 'Irreverent / Edgy' },
    { value: 'authentic', label: 'Authentic / Unfiltered' },
    { value: 'polished', label: 'Polished / Premium' },
    { value: 'comedic', label: 'Comedic / Sketch' },
    { value: 'informative', label: 'Informative / Educational' },
    { value: 'immersive', label: 'Immersive / Cinematic' },
  ],
  commercial: [
    { value: 'aspirational', label: 'Aspirational / Glossy' },
    { value: 'humorous', label: 'Humorous / Playful' },
    { value: 'emotional', label: 'Emotional / Heartfelt' },
    { value: 'bold', label: 'Bold / Provocative' },
    { value: 'minimal', label: 'Minimal / Design-Led' },
    { value: 'cinematic', label: 'Cinematic / Epic' },
    { value: 'documentary-style', label: 'Documentary-Style' },
  ],
  'branded-content': [
    { value: 'authentic', label: 'Authentic / Real' },
    { value: 'cinematic', label: 'Cinematic / Premium' },
    { value: 'playful', label: 'Playful / Engaging' },
    { value: 'purpose-driven', label: 'Purpose-Driven' },
    { value: 'cultural', label: 'Cultural / Zeitgeist' },
    { value: 'editorial', label: 'Editorial / Magazine' },
  ],
  'music-video': [
    { value: 'cinematic', label: 'Cinematic / Narrative' },
    { value: 'performance', label: 'Performance-Driven' },
    { value: 'abstract', label: 'Abstract / Visual Art' },
    { value: 'choreographic', label: 'Choreographic / Dance' },
    { value: 'documentary-style', label: 'Documentary / BTS' },
    { value: 'animated', label: 'Animated / Mixed Media' },
  ],
  'proof-of-concept': [
    { value: 'cinematic', label: 'Cinematic / High-End' },
    { value: 'lo-fi', label: 'Lo-Fi / Raw' },
    { value: 'vfx-heavy', label: 'VFX-Heavy / Technical' },
    { value: 'character-driven', label: 'Character-Driven' },
    { value: 'world-building', label: 'World-Building' },
  ],
  hybrid: [
    { value: 'immersive', label: 'Immersive / Experiential' },
    { value: 'interactive', label: 'Interactive / Participatory' },
    { value: 'documentary-fiction', label: 'Documentary-Fiction Blend' },
    { value: 'digital-physical', label: 'Digital-Physical Hybrid' },
    { value: 'experimental', label: 'Experimental / Art' },
  ],
  'vertical-drama': [
    { value: 'addictive', label: 'Addictive / Cliffhanger-Driven' },
    { value: 'escapist', label: 'Escapist / Fantasy' },
    { value: 'emotional', label: 'Emotional / Melodramatic' },
    { value: 'suspenseful', label: 'Suspenseful / Twisty' },
    { value: 'comedic', label: 'Comedic / Light' },
    { value: 'dark', label: 'Dark / Gritty' },
  ],
};

export const MODE_BUDGETS: Record<ProjectFormat, LabelValue[]> = {
  film: [...BUDGET_RANGES],
  'tv-series': [
    { value: 'under-500k-ep', label: 'Under $500K / ep' },
    { value: '500k-2m-ep', label: '$500K – $2M / ep' },
    { value: '2m-5m-ep', label: '$2M – $5M / ep' },
    { value: '5m-10m-ep', label: '$5M – $10M / ep' },
    { value: '10m-plus-ep', label: '$10M+ / ep' },
  ],
  'short-film': [
    { value: 'under-5k', label: 'Under $5K' },
    { value: '5k-25k', label: '$5K – $25K' },
    { value: '25k-100k', label: '$25K – $100K' },
    { value: '100k-500k', label: '$100K – $500K' },
    { value: '500k-plus', label: '$500K+' },
  ],
  documentary: [
    { value: 'under-50k', label: 'Under $50K' },
    { value: '50k-250k', label: '$50K – $250K' },
    { value: '250k-1m', label: '$250K – $1M' },
    { value: '1m-5m', label: '$1M – $5M' },
    { value: '5m-plus', label: '$5M+' },
  ],
  'documentary-series': [
    { value: 'under-50k-ep', label: 'Under $50K / ep' },
    { value: '50k-250k-ep', label: '$50K – $250K / ep' },
    { value: '250k-1m-ep', label: '$250K – $1M / ep' },
    { value: '1m-5m-ep', label: '$1M – $5M / ep' },
    { value: '5m-plus-ep', label: '$5M+ / ep' },
  ],
  'digital-series': [
    { value: 'under-10k-ep', label: 'Under $10K / ep' },
    { value: '10k-50k-ep', label: '$10K – $50K / ep' },
    { value: '50k-250k-ep', label: '$50K – $250K / ep' },
    { value: '250k-1m-ep', label: '$250K – $1M / ep' },
    { value: '1m-plus-ep', label: '$1M+ / ep' },
  ],
  commercial: [
    { value: 'under-50k', label: 'Under $50K' },
    { value: '50k-150k', label: '$50K – $150K' },
    { value: '150k-500k', label: '$150K – $500K' },
    { value: '500k-1m', label: '$500K – $1M' },
    { value: '1m-5m', label: '$1M – $5M' },
    { value: '5m-plus', label: '$5M+' },
  ],
  'branded-content': [
    { value: 'under-25k', label: 'Under $25K' },
    { value: '25k-100k', label: '$25K – $100K' },
    { value: '100k-500k', label: '$100K – $500K' },
    { value: '500k-2m', label: '$500K – $2M' },
    { value: '2m-plus', label: '$2M+' },
  ],
  'music-video': [
    { value: 'under-10k', label: 'Under $10K' },
    { value: '10k-50k', label: '$10K – $50K' },
    { value: '50k-150k', label: '$50K – $150K' },
    { value: '150k-500k', label: '$150K – $500K' },
    { value: '500k-plus', label: '$500K+' },
  ],
  'proof-of-concept': [
    { value: 'under-5k', label: 'Under $5K' },
    { value: '5k-25k', label: '$5K – $25K' },
    { value: '25k-100k', label: '$25K – $100K' },
    { value: '100k-500k', label: '$100K – $500K' },
    { value: '500k-plus', label: '$500K+' },
  ],
  hybrid: [
    { value: 'under-25k', label: 'Under $25K' },
    { value: '25k-100k', label: '$25K – $100K' },
    { value: '100k-500k', label: '$100K – $500K' },
    { value: '500k-2m', label: '$500K – $2M' },
    { value: '2m-plus', label: '$2M+' },
  ],
  'vertical-drama': [
    { value: 'under-10k-ep', label: 'Under $10K / ep' },
    { value: '10k-50k-ep', label: '$10K – $50K / ep' },
    { value: '50k-150k-ep', label: '$50K – $150K / ep' },
    { value: '150k-500k-ep', label: '$150K – $500K / ep' },
    { value: '500k-plus-ep', label: '$500K+ / ep' },
  ],
};

export const MODE_COMPARABLE_CONFIG: Record<ProjectFormat, { label: string; placeholder: string; hint: string }> = {
  film: { label: 'Comparable Titles', placeholder: 'e.g. Moonlight meets The Rider, with elements of Nomadland', hint: 'Reference films or shows that share a similar tone, audience, or market positioning.' },
  'tv-series': { label: 'Comparable Series', placeholder: 'e.g. Succession meets Industry, with the pacing of The Bear', hint: 'Reference series that share a similar format, audience, or platform positioning.' },
  'short-film': { label: 'Reference Work', placeholder: 'e.g. Inspired by the visual language of Barry Jenkins\' shorts', hint: 'Reference shorts, directors, or movements that inform the creative approach.' },
  documentary: { label: 'Comparable Documentaries', placeholder: 'e.g. The tone of Icarus meets the access of The Last Dance', hint: 'Reference documentaries with similar subject access, tone, or distribution path.' },
  'documentary-series': { label: 'Comparable Doc Series', placeholder: 'e.g. Making a Murderer meets Planet Earth in ambition', hint: 'Reference doc series with similar format, access, or platform positioning.' },
  'digital-series': { label: 'Comparable Digital Content', placeholder: 'e.g. The format of Hot Ones meets the audience of Vice', hint: 'Reference digital series, creators, or platforms that align with your vision.' },
  commercial: { label: 'Reference Campaigns', placeholder: 'e.g. Nike "Dream Crazy" visual ambition, Apple "Shot on iPhone" simplicity', hint: 'Reference campaigns or directors whose aesthetic or approach you\'re targeting.' },
  'branded-content': { label: 'Reference Content', placeholder: 'e.g. Patagonia\'s storytelling meets Red Bull\'s production value', hint: 'Reference branded content, brand films, or campaigns with a similar tone and purpose.' },
  'music-video': { label: 'Reference Videos', placeholder: 'e.g. Spike Jonze\'s energy meets Hiro Murai\'s visual storytelling', hint: 'Reference music videos, directors, or visual styles you\'re drawing from.' },
  'proof-of-concept': { label: 'Target Project', placeholder: 'e.g. Proving the world of our sci-fi feature, similar to District 9\'s early proof', hint: 'Describe the larger project this proof of concept is designed to unlock.' },
  hybrid: { label: 'Reference Projects', placeholder: 'e.g. Sleep No More\'s immersion meets Bandersnatch\'s interactivity', hint: 'Reference cross-platform, immersive, or transmedia projects that inspire your approach.' },
  'vertical-drama': { label: 'Reference Shows', placeholder: 'e.g. The pacing of ReelShort originals meets the drama of K-drama cliffhangers', hint: 'Reference vertical drama series, short-form shows, or mobile-first content that inspires your approach.' },
};

export const MODE_CREATIVE_LABEL: Record<ProjectFormat, { title: string; subtitle: string; genreLabel: string }> = {
  film: { title: 'Creative Profile', subtitle: 'Describe the creative identity of your project.', genreLabel: 'Genre' },
  'tv-series': { title: 'Creative Profile', subtitle: 'Describe the creative identity of your series.', genreLabel: 'Genre' },
  'short-film': { title: 'Creative Profile', subtitle: 'What defines the creative vision of your short?', genreLabel: 'Genre / Style' },
  documentary: { title: 'Subject & Approach', subtitle: 'Describe the subject matter and approach.', genreLabel: 'Subject Area' },
  'documentary-series': { title: 'Subject & Approach', subtitle: 'Describe the subject matter and series format.', genreLabel: 'Subject Area' },
  'digital-series': { title: 'Content Identity', subtitle: 'Define your content format and audience.', genreLabel: 'Content Category' },
  commercial: { title: 'Creative Brief', subtitle: 'Define the creative direction and brand sector.', genreLabel: 'Brand Sector' },
  'branded-content': { title: 'Brand & Creative', subtitle: 'Define the brand relationship and creative direction.', genreLabel: 'Content Category' },
  'music-video': { title: 'Visual Direction', subtitle: 'Define the visual approach and genre.', genreLabel: 'Music Genre' },
  'proof-of-concept': { title: 'Concept Profile', subtitle: 'What are you proving and for what target project?', genreLabel: 'Genre / Style' },
  hybrid: { title: 'Project Identity', subtitle: 'Define the cross-platform creative vision.', genreLabel: 'Format Type' },
  'vertical-drama': { title: 'Creative Profile', subtitle: 'Define the genre, tone, and hook of your vertical drama.', genreLabel: 'Genre' },
};

export const MODE_COMMERCIAL_LABEL: Record<ProjectFormat, { title: string; subtitle: string }> = {
  film: { title: 'Commercial Profile', subtitle: 'Help us understand the market positioning.' },
  'tv-series': { title: 'Commercial Profile', subtitle: 'Help us understand the market positioning.' },
  'short-film': { title: 'Budget & Strategy', subtitle: 'What\'s the funding approach and strategic goal?' },
  documentary: { title: 'Budget & Distribution', subtitle: 'How will this be funded and distributed?' },
  'documentary-series': { title: 'Budget & Distribution', subtitle: 'How will this be funded and distributed?' },
  'digital-series': { title: 'Budget & Platform', subtitle: 'What\'s the production budget and platform target?' },
  commercial: { title: 'Production Budget', subtitle: 'Define the production scope and client budget.' },
  'branded-content': { title: 'Brand Budget', subtitle: 'Define the brand funding and production scope.' },
  'music-video': { title: 'Production Budget', subtitle: 'Define the label/artist budget and scope.' },
  'proof-of-concept': { title: 'Budget & Goal', subtitle: 'What\'s the budget and what does success look like?' },
  hybrid: { title: 'Budget & Partners', subtitle: 'Define funding sources and technology partners.' },
  'vertical-drama': { title: 'Budget & Platform', subtitle: 'Define the per-episode budget and target platform.' },
};

export const FORMAT_OPTIONS = [
  { value: 'film', label: 'Feature Film' },
  { value: 'tv-series', label: 'TV Series' },
  { value: 'short-film', label: 'Short Film' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'digital-series', label: 'Digital Series' },
  { value: 'commercial', label: 'Commercial / Advert' },
  { value: 'branded-content', label: 'Branded Content' },
  { value: 'vertical-drama', label: 'Vertical Drama' },
] as const;

export const TV_SUBFORMAT_OPTIONS = [
  { value: 'limited', label: 'Limited Series' },
  { value: 'returning', label: 'Returning Series' },
  { value: 'anthology', label: 'Anthology' },
] as const;

export const TV_BUDGET_RANGES = [
  { value: 'under-500k-ep', label: 'Under $500K / ep' },
  { value: '500k-2m-ep', label: '$500K – $2M / ep' },
  { value: '2m-5m-ep', label: '$2M – $5M / ep' },
  { value: '5m-10m-ep', label: '$5M – $10M / ep' },
  { value: '10m-plus-ep', label: '$10M+ / ep' },
] as const;
