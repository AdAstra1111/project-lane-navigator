import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, RefreshCw, AlertTriangle, TrendingUp, Shield, Loader2 } from 'lucide-react';

export interface PromotionRecommendation {
  recommendation: 'promote' | 'stabilise' | 'escalate';
  next_document: string | null;
  readiness_score: number;
  confidence: number;
  reasons: string[];
  must_fix_next: string[];
  risk_flags: string[];
}

interface Props {
  data: PromotionRecommendation | null;
  isLoading: boolean;
  onPromote?: () => void;
  onReReview?: () => void;
  onEscalate?: () => void;
}

const LABELS: Record<string, { label: string; color: string; icon: typeof ArrowRight }> = {
  promote: { label: 'Promote', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: ArrowRight },
  stabilise: { label: 'Stabilise', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: RefreshCw },
  escalate: { label: 'Escalate', color: 'bg-destructive/15 text-destructive border-destructive/30', icon: AlertTriangle },
};

const DOC_LABELS: Record<string, string> = {
  idea: 'Idea', concept_brief: 'Concept Brief', blueprint: 'Blueprint',
  architecture: 'Architecture', draft: 'Draft', coverage: 'Coverage',
};

export function PromotionIntelligenceCard({ data, isLoading, onPromote, onReReview, onEscalate }: Props) {
  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Analysing promotion readiness…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { recommendation, next_document, readiness_score, confidence, reasons, must_fix_next, risk_flags } = data;
  const meta = LABELS[recommendation] || LABELS.stabilise;
  const Icon = meta.icon;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3" /> Next Step Recommendation
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Recommendation badge */}
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${meta.color}`}>
            <Icon className="h-3 w-3 mr-1" />
            {meta.label}
            {next_document ? ` → ${DOC_LABELS[next_document] || next_document}` : ''}
          </Badge>
        </div>

        {/* Scores */}
        <div className="flex gap-3 text-[10px]">
          <div className="flex items-center gap-1">
            <Shield className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">Readiness</span>
            <span className="font-semibold text-foreground">{readiness_score}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-semibold text-foreground">{confidence}%</span>
          </div>
        </div>

        {/* Reasons */}
        <div className="space-y-0.5">
          {reasons.slice(0, 5).map((r, i) => (
            <p key={i} className="text-[9px] text-muted-foreground">• {r}</p>
          ))}
        </div>

        {/* Must-fix-next */}
        {must_fix_next.length > 0 && (
          <div className="pt-1 border-t border-border/40 space-y-0.5">
            <p className="text-[9px] font-medium text-foreground">Next actions:</p>
            {must_fix_next.slice(0, 4).map((m, i) => (
              <p key={i} className="text-[9px] text-muted-foreground">→ {m}</p>
            ))}
          </div>
        )}

        {/* Risk flags */}
        {risk_flags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {risk_flags.map((f, i) => (
              <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 text-amber-500 border-amber-500/30">
                {f}
              </Badge>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="pt-1">
          {recommendation === 'promote' && onPromote && (
            <Button size="sm" className="w-full h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={onPromote}>
              <ArrowRight className="h-3 w-3" />
              Promote{next_document ? ` to ${DOC_LABELS[next_document] || next_document}` : ''}
            </Button>
          )}
          {recommendation === 'stabilise' && onReReview && (
            <Button size="sm" variant="outline" className="w-full h-7 text-[10px] gap-1" onClick={onReReview}>
              <RefreshCw className="h-3 w-3" /> Run another Editorial pass
            </Button>
          )}
          {recommendation === 'escalate' && onEscalate && (
            <Button size="sm" variant="destructive" className="w-full h-7 text-[10px] gap-1" onClick={onEscalate}>
              <AlertTriangle className="h-3 w-3" /> Run Executive Strategy Loop
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
