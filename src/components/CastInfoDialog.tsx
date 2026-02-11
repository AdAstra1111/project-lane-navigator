import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, TrendingUp, Award, AlertTriangle, ExternalLink, Search, Users, User, ImageIcon, Phone, Mail, Building2, UserCheck, Save, Film } from 'lucide-react';
import { usePersonResearch, type PersonAssessment, type DisambiguationCandidate } from '@/hooks/usePersonResearch';
import { usePersonImages } from '@/hooks/usePersonImages';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';

const TRAJECTORY_STYLES: Record<string, { label: string; className: string }> = {
  rising: { label: 'Rising', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  breakout: { label: 'Breakout', className: 'bg-primary/15 text-primary border-primary/30' },
  peak: { label: 'At Peak', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  steady: { label: 'Steady', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  declining: { label: 'Declining', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground border-border' },
};

const IMPACT_STYLES: Record<string, { label: string; className: string }> = {
  transformative: { label: 'Transformative', className: 'bg-primary/15 text-primary border-primary/30' },
  strong: { label: 'Strong', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  moderate: { label: 'Moderate', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  marginal: { label: 'Marginal', className: 'bg-muted text-muted-foreground border-border' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
  risky: { label: 'Risky', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface TmdbCredit {
  title: string;
  year: string;
  role: string;
  type: string;
}

interface TmdbData {
  found: boolean;
  tmdb_id?: number;
  imdb_id?: string;
  name?: string;
  biography?: string;
  birthday?: string;
  place_of_birth?: string;
  profile_url?: string;
  known_for_department?: string;
  popularity?: number;
  credits?: TmdbCredit[];
}

interface ContactFields {
  agent_name: string;
  manager_name: string;
  agency: string;
  contact_phone: string;
  contact_email: string;
}

interface CastInfoDialogProps {
  personName: string;
  reason: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectContext?: {
    title?: string;
    format?: string;
    budget_range?: string;
    genres?: string[];
  };
  /** Pass current contact fields from parent for editing */
  contactFields?: ContactFields;
  /** Called when contact fields are saved */
  onContactSave?: (fields: ContactFields) => void;
  /** Called when TMDb data provides imdb_id / tmdb_id */
  onExternalIds?: (ids: { imdb_id?: string; tmdb_id?: string }) => void;
}

export function CastInfoDialog({ personName, reason, open, onOpenChange, projectContext, contactFields, onContactSave, onExternalIds }: CastInfoDialogProps) {
  const { research, loading, assessments, candidates, confirmCandidate, clearDisambiguation } = usePersonResearch();
  const [hasRequested, setHasRequested] = useState(false);
  const { images, loading: imagesLoading } = usePersonImages(open ? personName : undefined);
  const [selectedImage, setSelectedImage] = useState<number>(0);

  // TMDb
  const [tmdbData, setTmdbData] = useState<TmdbData | null>(null);
  const [tmdbLoading, setTmdbLoading] = useState(false);

  // Contact editing
  const [editContact, setEditContact] = useState<ContactFields>({
    agent_name: '', manager_name: '', agency: '', contact_phone: '', contact_email: '',
  });
  const [contactDirty, setContactDirty] = useState(false);

  // Sync contact fields from parent
  useEffect(() => {
    if (contactFields) {
      setEditContact(contactFields);
      setContactDirty(false);
    }
  }, [contactFields]);

  const assessment = assessments[personName];
  const isLoading = loading === personName;

  // Fetch TMDb data
  const fetchTmdb = useCallback(async () => {
    if (tmdbData || tmdbLoading) return;
    setTmdbLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('tmdb-lookup', {
        body: { name: personName },
      });
      if (!error && data) {
        setTmdbData(data);
        if (data.found && onExternalIds) {
          onExternalIds({ imdb_id: data.imdb_id, tmdb_id: String(data.tmdb_id) });
        }
      }
    } catch (e) {
      console.error('TMDb lookup failed:', e);
    } finally {
      setTmdbLoading(false);
    }
  }, [personName, tmdbData, tmdbLoading, onExternalIds]);

  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      clearDisambiguation();
      setSelectedImage(0);
    }
    if (isOpen && !assessment && !hasRequested) {
      setHasRequested(true);
      research(personName, 'cast', projectContext);
    }
    if (isOpen) {
      fetchTmdb();
    }
  };

  const handleContactChange = (field: keyof ContactFields, value: string) => {
    setEditContact(prev => ({ ...prev, [field]: value }));
    setContactDirty(true);
  };

  const handleContactSave = () => {
    onContactSave?.(editContact);
    setContactDirty(false);
  };

  const trajectory = TRAJECTORY_STYLES[assessment?.market_trajectory || 'unknown'] || TRAJECTORY_STYLES.unknown;
  const impact = IMPACT_STYLES[assessment?.packaging_impact || 'neutral'] || IMPACT_STYLES.neutral;

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(personName + ' actor')}&tbm=isch`;
  const imdbId = tmdbData?.imdb_id;
  const imdbUrl = imdbId
    ? `https://pro.imdb.com/name/${imdbId}`
    : `https://pro.imdb.com/find/?q=${encodeURIComponent(personName)}&s=nm`;
  const imdbPublicUrl = imdbId
    ? `https://www.imdb.com/name/${imdbId}`
    : `https://www.imdb.com/find/?q=${encodeURIComponent(personName)}&s=nm`;

  // Bio snippet (first 2 sentences)
  const bioSnippet = tmdbData?.biography
    ? tmdbData.biography.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ')
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            {tmdbData?.name || personName}
            {tmdbData?.known_for_department && (
              <Badge variant="secondary" className="text-[10px] font-normal">{tmdbData.known_for_department}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
          {/* Left: Photos */}
          <div className="space-y-2">
            <div className="aspect-[3/4] rounded-lg bg-muted overflow-hidden flex items-center justify-center">
              {imagesLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (tmdbData?.profile_url || images.length > 0) ? (
                <img
                  src={selectedImage === 0 && tmdbData?.profile_url ? tmdbData.profile_url : (images[selectedImage] || images[0])}
                  alt={personName}
                  className="h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <User className="h-12 w-12" />
                  <span className="text-xs">No photo found</span>
                </div>
              )}
            </div>

            {images.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {images.slice(0, 6).map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`h-12 w-12 rounded-md overflow-hidden shrink-0 border-2 transition-colors ${
                      i === selectedImage ? 'border-primary' : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* External links */}
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="outline" className="text-xs w-full" onClick={() => (window.top || window).open(imdbUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                IMDb Pro
              </Button>
              <Button size="sm" variant="outline" className="text-xs w-full" onClick={() => (window.top || window).open(imdbPublicUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                IMDb
              </Button>
              <Button size="sm" variant="outline" className="text-xs w-full" onClick={() => (window.top || window).open(searchUrl, '_blank', 'noopener,noreferrer')}>
                <ImageIcon className="h-3.5 w-3.5 mr-1" />
                More Photos
              </Button>
            </div>
          </div>

          {/* Right: Info */}
          <div className="space-y-4 min-w-0">
            <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>

            {projectContext?.title && (
              <div className="bg-muted/30 rounded-lg px-3 py-2 text-xs">
                <span className="text-muted-foreground">Assessing fit for </span>
                <span className="text-primary font-semibold">{projectContext.title}</span>
                {projectContext.genres && projectContext.genres.length > 0 && (
                  <span className="text-muted-foreground"> · {projectContext.genres.join(', ')}</span>
                )}
                {projectContext.budget_range && (
                  <span className="text-muted-foreground"> · {projectContext.budget_range}</span>
                )}
              </div>
            )}

            {/* TMDb Bio */}
            {bioSnippet && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Bio</p>
                <p className="text-sm text-foreground leading-relaxed">{bioSnippet}</p>
                {tmdbData?.birthday && (
                  <p className="text-xs text-muted-foreground">
                    Born: {tmdbData.birthday}{tmdbData.place_of_birth ? ` · ${tmdbData.place_of_birth}` : ''}
                  </p>
                )}
              </div>
            )}

            {/* TMDb Filmography */}
            {tmdbData?.credits && tmdbData.credits.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Film className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Filmography</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tmdbData.credits.map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">
                      {c.title}{c.year ? ` (${c.year})` : ''}{c.role ? ` — ${c.role}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {tmdbLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading filmography…
              </div>
            )}

            {/* Loading AI assessment */}
            {isLoading && (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Researching {personName}…
              </div>
            )}

            {/* Disambiguation */}
            {candidates && candidates.length > 1 && !isLoading && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  Multiple people found — which one?
                </div>
                <div className="space-y-2">
                  {candidates.map((c, i) => (
                    <button key={i} onClick={() => confirmCandidate(c)} className="w-full text-left border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors">
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.descriptor}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Known for: <span className="text-foreground">{c.known_for}</span></p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* AI Assessment */}
            {assessment && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge className={`text-[10px] px-2 py-0.5 border ${trajectory.className}`}>{trajectory.label}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Award className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge className={`text-[10px] px-2 py-0.5 border ${impact.className}`}>{impact.label} Impact</Badge>
                  </div>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{assessment.summary}</p>
                {assessment.notable_credits.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">AI-Assessed Credits</p>
                    <div className="flex flex-wrap gap-1.5">
                      {assessment.notable_credits.map((credit, i) => (
                        <Badge key={i} variant="secondary" className="text-xs font-normal">{credit}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {assessment.risk_flags.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Risk Flags</p>
                    {assessment.risk_flags.map((flag, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {!isLoading && !assessment && !candidates && hasRequested && (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">Could not load assessment.</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => research(personName, 'cast', projectContext)}>Retry</Button>
              </div>
            )}

            {/* Representation / Contact Fields */}
            {onContactSave && (
              <div className="border-t border-border/50 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5" />
                    Representation & Contact
                  </p>
                  {contactDirty && (
                    <Button size="sm" variant="default" className="h-6 text-[10px] px-2" onClick={handleContactSave}>
                      <Save className="h-3 w-3 mr-1" /> Save
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><UserCheck className="h-2.5 w-2.5" /> Agent</label>
                    <Input className="h-7 text-xs" placeholder="Agent name" value={editContact.agent_name} onChange={e => handleContactChange('agent_name', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><UserCheck className="h-2.5 w-2.5" /> Manager</label>
                    <Input className="h-7 text-xs" placeholder="Manager name" value={editContact.manager_name} onChange={e => handleContactChange('manager_name', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Building2 className="h-2.5 w-2.5" /> Agency</label>
                    <Input className="h-7 text-xs" placeholder="Agency (e.g. CAA, WME)" value={editContact.agency} onChange={e => handleContactChange('agency', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Phone className="h-2.5 w-2.5" /> Phone</label>
                    <Input className="h-7 text-xs" placeholder="Phone number" value={editContact.contact_phone} onChange={e => handleContactChange('contact_phone', e.target.value)} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Mail className="h-2.5 w-2.5" /> Email</label>
                    <Input className="h-7 text-xs" placeholder="Contact email" value={editContact.contact_email} onChange={e => handleContactChange('contact_email', e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
