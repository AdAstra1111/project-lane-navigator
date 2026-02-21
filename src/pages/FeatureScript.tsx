import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Upload, Zap, Download, Loader2, FileText, AlertTriangle,
  CheckCircle2, ChevronRight, X, Save, Eye, Link2, Globe, Users,
} from 'lucide-react';
import { useFeatureScript, type ScriptUnit, type AnalysisResult, type AnalysisNote } from '@/hooks/useFeatureScript';
import { toast } from 'sonner';

// ── Severity colors ──
const SEVERITY_CONFIG = {
  must: { color: 'bg-red-500/20 text-red-300 border-red-500/40', label: 'Must Fix' },
  should: { color: 'bg-amber-500/20 text-amber-300 border-amber-500/40', label: 'Should Fix' },
  could: { color: 'bg-blue-500/20 text-blue-300 border-blue-500/40', label: 'Consider' },
};

export default function FeatureScriptPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    blueprint, scenes, links, worldState,
    blueprintLoading, scenesLoading,
    isIngesting, isBuildingBlueprint,
    ingestScript, buildBlueprint, analyseScene, applyFix,
    saveSceneVersion, exportScreenplay,
  } = useFeatureScript(projectId!);

  // UI State
  const [scriptInput, setScriptInput] = useState('');
  const [selectedScene, setSelectedScene] = useState<ScriptUnit | null>(null);
  const [editedText, setEditedText] = useState('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [isApplyingFix, setIsApplyingFix] = useState<string | null>(null);

  const hasBlueprint = !!blueprint;
  const hasScenes = scenes.length > 0;

  // ── Handlers ──
  const handleIngest = useCallback(async () => {
    if (!scriptInput.trim()) {
      toast.error('Please paste a script');
      return;
    }
    const result = await ingestScript(scriptInput);
    if (result?.blueprintId) {
      await buildBlueprint(result.blueprintId);
    }
    setScriptInput('');
  }, [scriptInput, ingestScript, buildBlueprint]);

  const handleOpenScene = useCallback((scene: ScriptUnit) => {
    setSelectedScene(scene);
    setEditedText(scene.plaintext);
    setAnalysisResult(null);
  }, []);

  const handleAnalyse = useCallback(async () => {
    if (!selectedScene) return;
    setIsAnalysing(true);
    try {
      const result = await analyseScene(selectedScene.id, editedText !== selectedScene.plaintext ? editedText : undefined);
      setAnalysisResult(result);
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed');
    } finally {
      setIsAnalysing(false);
    }
  }, [selectedScene, editedText, analyseScene]);

  const handleSave = useCallback(async () => {
    if (!selectedScene) return;
    await saveSceneVersion(selectedScene.id, editedText);
  }, [selectedScene, editedText, saveSceneVersion]);

  const handleApplyFix = useCallback(async (note: AnalysisNote, fix: any) => {
    if (!selectedScene) return;
    setIsApplyingFix(fix.fix_id);
    try {
      await applyFix(selectedScene.id, { action: fix.action, payload: fix.payload });
      setAnalysisResult(null);
    } catch (err: any) {
      toast.error(err.message || 'Fix failed');
    } finally {
      setIsApplyingFix(null);
    }
  }, [selectedScene, applyFix]);

  const handleRebuildBlueprint = useCallback(async () => {
    if (!blueprint) return;
    await buildBlueprint(blueprint.id);
  }, [blueprint, buildBlueprint]);

  // ── Scene context ──
  const sceneLinks = selectedScene ? {
    from: links.filter(l => l.from_unit_id === selectedScene.id),
    to: links.filter(l => l.to_unit_id === selectedScene.id),
  } : { from: [], to: [] };

  const blueprintJson = blueprint?.blueprint_json || {};
  const characters = blueprintJson.characters || [];
  const sceneCharacters = selectedScene
    ? (selectedScene.unit_json as any)?.characters_present || []
    : [];

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-6 max-w-7xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${projectId}`)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Feature Script Engine</h1>
                <p className="text-sm text-muted-foreground">
                  {hasScenes ? `${scenes.length} scenes • Blueprint ${hasBlueprint ? 'active' : 'pending'}` : 'Ingest a screenplay to begin'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasBlueprint && (
                <Button variant="outline" size="sm" onClick={handleRebuildBlueprint} disabled={isBuildingBlueprint}>
                  {isBuildingBlueprint ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
                  Rebuild Blueprint
                </Button>
              )}
              {hasScenes && (
                <Button variant="outline" size="sm" onClick={exportScreenplay}>
                  <Download className="h-4 w-4 mr-1" />
                  Export Screenplay
                </Button>
              )}
            </div>
          </div>

          {/* Scene Editor Drawer */}
          {selectedScene ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Editor */}
              <Card className="border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-medium">{selectedScene.slugline || selectedScene.title}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">Scene {selectedScene.order_index + 1}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={handleSave} disabled={editedText === selectedScene.plaintext}>
                        <Save className="h-3 w-3 mr-1" />Save
                      </Button>
                      <Button size="sm" onClick={handleAnalyse} disabled={isAnalysing}>
                        {isAnalysing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                        Analyse
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setSelectedScene(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={editedText}
                    onChange={e => setEditedText(e.target.value)}
                    className="min-h-[500px] font-mono text-xs leading-relaxed resize-none"
                    placeholder="Scene text..."
                  />
                </CardContent>
              </Card>

              {/* Right: Context + Notes */}
              <div className="space-y-4">
                {/* Blueprint Context */}
                <Card className="border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />Blueprint Context
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {sceneCharacters.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Characters Present</p>
                        <div className="flex flex-wrap gap-1">
                          {sceneCharacters.map((c: string) => (
                            <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {(selectedScene.unit_json as any)?.intent && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Intent</p>
                        <p className="text-xs">{(selectedScene.unit_json as any).intent}</p>
                      </div>
                    )}
                    {(selectedScene.unit_json as any)?.conflict && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Conflict</p>
                        <p className="text-xs">{(selectedScene.unit_json as any).conflict}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Dependencies */}
                {(sceneLinks.from.length > 0 || sceneLinks.to.length > 0) && (
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-primary" />Dependencies ({sceneLinks.from.length + sceneLinks.to.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-40">
                        <div className="space-y-1">
                          {sceneLinks.from.map(l => {
                            const target = scenes.find(s => s.id === l.to_unit_id);
                            return (
                              <div key={l.id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted/50 cursor-pointer"
                                onClick={() => target && handleOpenScene(target)}>
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                <Badge variant="outline" className="text-[10px]">{l.link_type}</Badge>
                                <span className="truncate">{target?.slugline || 'Unknown'}</span>
                              </div>
                            );
                          })}
                          {sceneLinks.to.map(l => {
                            const source = scenes.find(s => s.id === l.from_unit_id);
                            return (
                              <div key={l.id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted/50 cursor-pointer"
                                onClick={() => source && handleOpenScene(source)}>
                                <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                                <Badge variant="outline" className="text-[10px]">{l.link_type}</Badge>
                                <span className="truncate">{source?.slugline || 'Unknown'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* World State Context */}
                {worldState && (
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Globe className="h-4 w-4 text-primary" />World State
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-32">
                        <div className="space-y-2 text-xs">
                          {(worldState as any)?.prop_ledger?.slice(0, 5).map((p: any, i: number) => (
                            <div key={i} className="flex justify-between">
                              <span>{p.prop}</span>
                              <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                            </div>
                          ))}
                          {(worldState as any)?.knowledge_ledger?.slice(0, 3).map((k: any, i: number) => (
                            <div key={i}>
                              <span className="font-medium">{k.character}</span>: knows {k.knows?.slice(0, 2).join(', ')}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Analysis Notes */}
                {analysisResult && (
                  <Card className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        Analysis Notes ({analysisResult.notes?.length || 0})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-[300px]">
                        <div className="space-y-3">
                          {(analysisResult.notes || []).map((note) => (
                            <div key={note.id} className="border border-border rounded-md p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge className={`text-[10px] ${SEVERITY_CONFIG[note.severity]?.color || ''}`}>
                                  {SEVERITY_CONFIG[note.severity]?.label || note.severity}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">{note.scope}</Badge>
                              </div>
                              <p className="text-xs font-medium">{note.summary}</p>
                              <p className="text-xs text-muted-foreground">{note.detail}</p>
                              {note.suggested_fixes?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {note.suggested_fixes.map((fix) => (
                                    <Button
                                      key={fix.fix_id}
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7"
                                      disabled={isApplyingFix === fix.fix_id}
                                      onClick={() => handleApplyFix(note, fix)}
                                    >
                                      {isApplyingFix === fix.fix_id ? (
                                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                      ) : (
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                      )}
                                      {fix.label}
                                    </Button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          {analysisResult.impacts?.length > 0 && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs font-medium mb-2">Impacted Scenes</p>
                                {analysisResult.impacts.map((imp, i) => {
                                  const impScene = scenes.find(s => s.id === imp.unit_id);
                                  return (
                                    <div key={i} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted/50 cursor-pointer"
                                      onClick={() => impScene && handleOpenScene(impScene)}>
                                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                                      <span>{impScene?.slugline || imp.unit_id}</span>
                                      <span className="text-muted-foreground">— {imp.why}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Ingest Card */}
              {!hasScenes && (
                <Card className="border-border mb-6">
                  <CardHeader>
                    <CardTitle className="text-lg font-medium flex items-center gap-2">
                      <Upload className="h-5 w-5 text-primary" />
                      Ingest Feature Script
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      value={scriptInput}
                      onChange={e => setScriptInput(e.target.value)}
                      placeholder="Paste your feature screenplay here (with INT./EXT. sluglines)..."
                      className="min-h-[200px] font-mono text-xs"
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {scriptInput.length > 0 ? `${scriptInput.length.toLocaleString()} characters` : 'Accepts standard screenplay format with sluglines'}
                      </p>
                      <Button onClick={handleIngest} disabled={isIngesting || !scriptInput.trim()}>
                        {isIngesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                        Ingest & Build Blueprint
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Blueprint Grid */}
              {hasScenes && (
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg font-medium flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Feature Blueprint Grid
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{scenes.length} scenes</p>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {(blueprintLoading || scenesLoading) ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left p-2 text-muted-foreground font-medium w-12">#</th>
                              <th className="text-left p-2 text-muted-foreground font-medium">Slugline</th>
                              <th className="text-left p-2 text-muted-foreground font-medium hidden md:table-cell">Characters</th>
                              <th className="text-left p-2 text-muted-foreground font-medium hidden lg:table-cell">Intent</th>
                              <th className="text-left p-2 text-muted-foreground font-medium hidden lg:table-cell">Tags</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scenes.map((scene) => {
                              const uj = scene.unit_json as any;
                              const chars = uj?.characters_present || [];
                              const setupTags = uj?.setup_tags || [];
                              const payoffTags = uj?.payoff_tags || [];
                              return (
                                <tr
                                  key={scene.id}
                                  className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                                  onClick={() => handleOpenScene(scene)}
                                >
                                  <td className="p-2 text-muted-foreground">{scene.order_index + 1}</td>
                                  <td className="p-2 font-medium truncate max-w-[200px]">
                                    {scene.slugline || scene.title || 'Untitled'}
                                  </td>
                                  <td className="p-2 hidden md:table-cell">
                                    <div className="flex flex-wrap gap-1">
                                      {chars.slice(0, 3).map((c: string) => (
                                        <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                                      ))}
                                      {chars.length > 3 && (
                                        <Badge variant="outline" className="text-[10px]">+{chars.length - 3}</Badge>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-2 hidden lg:table-cell text-muted-foreground truncate max-w-[200px]">
                                    {uj?.intent || '—'}
                                  </td>
                                  <td className="p-2 hidden lg:table-cell">
                                    <div className="flex flex-wrap gap-1">
                                      {setupTags.slice(0, 2).map((t: string) => (
                                        <Badge key={t} variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">S: {t}</Badge>
                                      ))}
                                      {payoffTags.slice(0, 2).map((t: string) => (
                                        <Badge key={t} variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">P: {t}</Badge>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
