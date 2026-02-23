import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft, CheckCircle2, XCircle, Edit3, GitCompare,
  Lock, Unlock, Loader2,
} from 'lucide-react';
import type { VisualUnitCandidate, VisualUnit } from '@/lib/types/visualUnits';

interface Props {
  candidate: VisualUnitCandidate;
  canonicalUnit?: VisualUnit;
  onAccept: () => void;
  onReject: (reason?: string) => void;
  onModify: (patch: Record<string, any>, note?: string) => void;
  onCompare: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onBack: () => void;
  isPending: boolean;
}

export function VisualUnitCandidateCard({
  candidate, canonicalUnit, onAccept, onReject, onModify, onCompare,
  onLock, onUnlock, onBack, isPending,
}: Props) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyPatch, setModifyPatch] = useState('{}');
  const [modifyNote, setModifyNote] = useState('');

  const p = candidate.candidate_payload;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBack}>
            <ArrowLeft className="h-3 w-3" />
          </Button>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-xs truncate">{candidate.unit_key}</CardTitle>
            <p className="text-[9px] text-muted-foreground">{candidate.status}</p>
          </div>
          {canonicalUnit && (
            <Badge variant={canonicalUnit.locked ? 'destructive' : 'outline'} className="text-[7px] gap-0.5">
              {canonicalUnit.locked ? <Lock className="h-2 w-2" /> : null}
              {canonicalUnit.locked ? 'Locked' : canonicalUnit.stale ? 'Stale' : 'Canonical'}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[55vh]">
            <div className="space-y-3 pr-2">
              {/* Logline */}
              <div>
                <p className="text-[9px] font-medium text-muted-foreground uppercase">Logline</p>
                <p className="text-xs">{p?.logline}</p>
              </div>

              {/* Core fields */}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pivot" value={p?.pivot} />
                <Field label="Stakes Shift" value={p?.stakes_shift} />
                <Field label="Power Shift" value={p?.power_shift} />
                <Field label="Location" value={p?.location} />
                <Field label="Time" value={p?.time} />
                <Field label="Scene" value={p?.scene_number != null ? `#${p.scene_number}` : '—'} />
              </div>

              <div>
                <p className="text-[9px] font-medium text-muted-foreground uppercase">Visual Intention</p>
                <p className="text-xs">{p?.visual_intention}</p>
              </div>

              {/* Characters */}
              {p?.characters_present?.length > 0 && (
                <div>
                  <p className="text-[9px] font-medium text-muted-foreground uppercase">Characters</p>
                  <div className="flex flex-wrap gap-1">{p.characters_present.map((c: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[8px]">{c}</Badge>
                  ))}</div>
                </div>
              )}

              {/* Tone + Setpieces */}
              <div className="flex gap-4">
                {p?.tone?.length > 0 && (
                  <div>
                    <p className="text-[9px] font-medium text-muted-foreground uppercase">Tone</p>
                    <div className="flex flex-wrap gap-1">{p.tone.map((t: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[8px]">{t}</Badge>
                    ))}</div>
                  </div>
                )}
                {p?.setpieces?.length > 0 && (
                  <div>
                    <p className="text-[9px] font-medium text-muted-foreground uppercase">Setpieces</p>
                    <div className="flex flex-wrap gap-1">{p.setpieces.map((s: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[8px]">{s}</Badge>
                    ))}</div>
                  </div>
                )}
              </div>

              {/* Scores */}
              <div>
                <p className="text-[9px] font-medium text-muted-foreground uppercase mb-1">Scores</p>
                <div className="grid grid-cols-4 gap-1 text-center">
                  <ScoreBox label="Trailer" value={p?.trailer_value} />
                  <ScoreBox label="Storyboard" value={p?.storyboard_value} />
                  <ScoreBox label="Pitch" value={p?.pitch_value} />
                  <ScoreBox label="Complexity" value={p?.complexity} />
                </div>
              </div>

              {/* Suggested shots */}
              {p?.suggested_shots?.length > 0 && (
                <div>
                  <p className="text-[9px] font-medium text-muted-foreground uppercase mb-1">Suggested Shots</p>
                  <div className="space-y-1">
                    {p.suggested_shots.map((s: any, i: number) => (
                      <div key={i} className="text-[10px] p-1.5 rounded border border-border">
                        <span className="font-medium">{s.type}</span> — {s.subject}
                        <span className="text-muted-foreground ml-1">({s.purpose})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risks */}
              {p?.risks?.length > 0 && (
                <div>
                  <p className="text-[9px] font-medium text-muted-foreground uppercase">Risks</p>
                  <div className="flex flex-wrap gap-1">{p.risks.map((r: string, i: number) => (
                    <Badge key={i} variant="destructive" className="text-[8px]">{r}</Badge>
                  ))}</div>
                </div>
              )}

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap gap-1">
                {candidate.status === 'proposed' || candidate.status === 'modified' ? (
                  <>
                    <Button size="sm" className="text-[10px] gap-1 h-7" onClick={onAccept} disabled={isPending}>
                      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="text-[10px] gap-1 h-7" onClick={() => setRejectOpen(true)} disabled={isPending}>
                      <XCircle className="h-3 w-3" />Reject
                    </Button>
                    <Button size="sm" variant="outline" className="text-[10px] gap-1 h-7" onClick={() => setModifyOpen(true)}>
                      <Edit3 className="h-3 w-3" />Modify
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="outline" className="text-[10px] gap-1 h-7" onClick={onCompare}>
                  <GitCompare className="h-3 w-3" />Compare
                </Button>
                {canonicalUnit && (
                  <Button size="sm" variant="ghost" className="text-[10px] gap-1 h-7"
                    onClick={canonicalUnit.locked ? onUnlock : onLock}>
                    {canonicalUnit.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {canonicalUnit.locked ? 'Unlock' : 'Lock'}
                  </Button>
                )}
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm">Reject Candidate</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason (optional)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="text-xs" />
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onReject(rejectReason); setRejectOpen(false); setRejectReason(''); }}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modify Dialog */}
      <Dialog open={modifyOpen} onOpenChange={setModifyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm">Modify Candidate</DialogTitle></DialogHeader>
          <Textarea placeholder='JSON patch, e.g. {"logline": "Updated..."}'
            value={modifyPatch} onChange={e => setModifyPatch(e.target.value)}
            className="text-xs font-mono min-h-[120px]" />
          <Textarea placeholder="Note (optional)" value={modifyNote} onChange={e => setModifyNote(e.target.value)} className="text-xs" />
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setModifyOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => {
              try {
                const patch = JSON.parse(modifyPatch);
                onModify(patch, modifyNote || undefined);
                setModifyOpen(false);
                setModifyPatch('{}');
                setModifyNote('');
              } catch { /* toast handled by parent */ }
            }}>Create Modified</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-[9px] font-medium text-muted-foreground uppercase">{label}</p>
      <p className="text-[10px]">{value || '—'}</p>
    </div>
  );
}

function ScoreBox({ label, value }: { label: string; value?: number }) {
  return (
    <div className="p-1.5 rounded border border-border">
      <p className="text-sm font-bold text-primary">{value ?? '—'}</p>
      <p className="text-[8px] text-muted-foreground">{label}</p>
    </div>
  );
}
