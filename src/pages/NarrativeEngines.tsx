/**
 * NarrativeEngines — Atlas page listing the 12 seeded narrative engines
 * with structural traits, linked DNA profiles, and blueprint families.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Dna, Layers, Loader2, ChevronRight, AlertTriangle, Boxes } from 'lucide-react';
import { useNarrativeEngines, useNarrativeEngine } from '@/hooks/useNarrativeEngines';
import { useBlueprintFamilies } from '@/hooks/useNarrativeDna';

export default function NarrativeEngines() {
  const navigate = useNavigate();
  const { data: engines = [], isLoading } = useNarrativeEngines();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: engineDetail, isLoading: detailLoading } = useNarrativeEngine(selectedKey || undefined);
  const { data: families = [] } = useBlueprintFamilies(selectedKey || undefined);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">Narrative Engine Atlas</h1>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => navigate('/narrative-dna')}
          >
            <Dna className="h-3 w-3" />
            DNA Profiles
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Browse the 12 canonical narrative engines. Each engine represents a deep structural pattern
          that drives stories across genres, settings, and eras. DNA profiles are classified into these engines during extraction.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading engines…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Engine list */}
            <div className="lg:col-span-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Engines ({engines.length})
              </h3>
              <ScrollArea className="max-h-[65vh]">
                <div className="space-y-1.5 pr-2">
                  {engines.map(engine => (
                    <button
                      key={engine.engine_key}
                      onClick={() => setSelectedKey(engine.engine_key)}
                      className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                        selectedKey === engine.engine_key
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-accent/30 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">{engine.engine_name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {engine.profile_count > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {engine.profile_count}
                            </Badge>
                          )}
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {engine.description}
                      </p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Engine detail */}
            <div className="lg:col-span-2 space-y-4">
              {selectedKey && engineDetail ? (
                <>
                  <Card className="border-border/50 bg-card/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        {engineDetail.engine.engine_name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {engineDetail.engine.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {engineDetail.engine.engine_key}
                        </Badge>
                        {engineDetail.engine.taxonomy_version && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            v{engineDetail.engine.taxonomy_version}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Structural Pattern */}
                      {engineDetail.engine.structural_pattern && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                            Structural Pattern
                          </h4>
                          <p className="text-xs text-foreground/80 leading-relaxed">
                            {engineDetail.engine.structural_pattern}
                          </p>
                        </div>
                      )}

                      {/* Structural Traits Grid */}
                      {engineDetail.engine.structural_traits && Object.keys(engineDetail.engine.structural_traits).length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                            Structural Traits
                          </h4>
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(engineDetail.engine.structural_traits).map(([key, val]) => (
                              <div key={key} className="flex items-center gap-1.5 text-[11px]">
                                <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{val}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Key properties */}
                      <div className="grid grid-cols-2 gap-3">
                        {engineDetail.engine.antagonist_topology && (
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase">Antagonist Topology</span>
                            <p className="text-xs text-foreground/80">{engineDetail.engine.antagonist_topology.replace(/_/g, ' ')}</p>
                          </div>
                        )}
                        {engineDetail.engine.escalation_pattern && (
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase">Escalation</span>
                            <p className="text-xs text-foreground/80">{engineDetail.engine.escalation_pattern.replace(/_/g, ' ')}</p>
                          </div>
                        )}
                        {engineDetail.engine.protagonist_pressure_mode && (
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase">Pressure Mode</span>
                            <p className="text-xs text-foreground/80">{engineDetail.engine.protagonist_pressure_mode.replace(/_/g, ' ')}</p>
                          </div>
                        )}
                        {engineDetail.engine.spatial_logic && (
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase">Spatial Logic</span>
                            <p className="text-xs text-foreground/80">{engineDetail.engine.spatial_logic.replace(/_/g, ' ')}</p>
                          </div>
                        )}
                      </div>

                      {/* Example Titles */}
                      {engineDetail.engine.example_titles && engineDetail.engine.example_titles.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                            Reference Titles
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {engineDetail.engine.example_titles.map((t: string) => (
                              <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Failure Modes */}
                      {engineDetail.engine.failure_modes && engineDetail.engine.failure_modes.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Failure Modes
                          </h4>
                          <ul className="space-y-0.5">
                            {engineDetail.engine.failure_modes.map((f: string, i: number) => (
                              <li key={i} className="text-[11px] text-muted-foreground">• {f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Linked Profiles */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          Linked DNA Profiles ({engineDetail.profiles.length})
                        </h4>
                        {engineDetail.profiles.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground py-2">
                            No DNA profiles mapped to this engine yet.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {engineDetail.profiles.map(p => (
                              <button
                                key={p.id}
                                onClick={() => navigate('/narrative-dna')}
                                className="w-full text-left px-3 py-2 rounded-md border border-border/30 hover:bg-accent/20 transition-colors"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium text-foreground truncate">{p.source_title}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {p.extraction_confidence != null && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                        {Math.round(p.extraction_confidence * 100)}%
                                      </Badge>
                                    )}
                                    <Badge
                                      variant={p.status === 'locked' ? 'default' : 'secondary'}
                                      className="text-[10px] px-1.5 py-0"
                                    >
                                      {p.status}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <span>{p.source_type}</span>
                                  {p.secondary_engine_key === selectedKey && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0">secondary</Badge>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Blueprint Families */}
                  {families.length > 0 && (
                    <Card className="border-border/50 bg-card/60">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Boxes className="h-4 w-4 text-primary" />
                          Blueprint Families ({families.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {families.map(f => (
                          <div key={f.id} className="px-3 py-2.5 rounded-md border border-border/30 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-foreground">{f.label}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{f.family_key}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{f.description}</p>
                            {f.structural_strengths.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {f.structural_strengths.map(s => (
                                  <Badge key={s} variant="secondary" className="text-[9px]">✓ {s}</Badge>
                                ))}
                              </div>
                            )}
                            {f.structural_risks.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {f.structural_risks.map(r => (
                                  <Badge key={r} variant="outline" className="text-[9px] border-destructive/30 text-destructive">⚠ {r}</Badge>
                                ))}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {f.lane_suitability.map(l => (
                                <Badge key={l} variant="secondary" className="text-[9px]">{l}</Badge>
                              ))}
                              {f.budget_suitability.map(b => (
                                <Badge key={b} variant="outline" className="text-[9px]">${b}</Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : detailLoading ? (
                <div className="flex items-center justify-center h-[300px] gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground border border-dashed border-border/40 rounded-lg">
                  Select an engine to view structural traits, blueprint families, and linked profiles
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
