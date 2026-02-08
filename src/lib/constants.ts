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
  { value: 'film', label: 'Film' },
  { value: 'tv-series', label: 'TV Series' },
] as const;
