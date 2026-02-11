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

export const FORMAT_OPTIONS = [
  { value: 'film', label: 'Feature Film' },
  { value: 'tv-series', label: 'TV Series' },
  { value: 'short-film', label: 'Short Film' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'digital-series', label: 'Digital Series' },
  { value: 'commercial', label: 'Commercial / Advert' },
  { value: 'branded-content', label: 'Branded Content' },
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
