/**
 * DecisionCard — Single decision item with selectable options + "Other" custom solution.
 */
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, ShieldAlert, AlertTriangle, Pencil } from 'lucide-react';

export const OTHER_OPTION_ID = '__other__';

export interface DecisionOption {
  option_id: string;
  title: string;
  what_changes: string[];
  tradeoffs?: string;
  creative_tradeoff?: string;
  creative_risk?: 'low' | 'med' | 'high';
  commercial_lift: number;
}

export interface Decision {
  note_id: string;
  severity: string;
  note: string;
  options: DecisionOption[];
  recommended_option_id?: string;
  /** legacy field */
  recommended?: string;
}

interface DecisionCardProps {
  decision: Decision;
  selectedOptionId?: string;
  customDirection?: string;
  onSelectOption: (optionId: string) => void;
  onCustomDirection: (text: string) => void;
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-emerald-400 border-emerald-500/30',
  med: 'text-amber-400 border-amber-500/30',
  high: 'text-destructive border-destructive/30',
};

function OptionRow({
  option, isSelected, isRecommended, onSelect,
}: {
  option: DecisionOption;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
}) {
  const tradeoffText = option.tradeoffs || option.creative_tradeoff || '';
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded px-2.5 py-2 border transition-all ${
        isSelected
          ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/30'
          : 'border-border/30 bg-muted/20 hover:border-border/60'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
        }`}>
          {isSelected && <CheckCircle2 className="h-2.5 w-2.5 text-primary-foreground" />}
        </div>
        <span className="text-[11px] font-medium text-foreground">{option.title}</span>
        {isRecommended && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
            Recommended
          </Badge>
        )}
        {option.creative_risk && (
          <Badge variant="outline" className={`text-[8px] px-1 py-0 ${RISK_COLORS[option.creative_risk] || ''}`}>
            {option.creative_risk} risk
          </Badge>
        )}
        {option.commercial_lift > 0 && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-emerald-500/30 text-emerald-500">
            +{option.commercial_lift} GP
          </Badge>
        )}
      </div>
      <div className="pl-5 space-y-0.5">
        <div className="flex flex-wrap gap-0.5">
          {option.what_changes.map((c, i) => (
            <Badge key={i} variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground border-border/40">
              {c}
            </Badge>
          ))}
        </div>
        {tradeoffText && (
          <p className="text-[9px] text-muted-foreground italic">{tradeoffText}</p>
        )}
      </div>
    </button>
  );
}

export function DecisionCard({ decision, selectedOptionId, customDirection, onSelectOption, onCustomDirection }: DecisionCardProps) {
  const recommendedId = decision.recommended_option_id || decision.recommended;
  const isOtherSelected = selectedOptionId === OTHER_OPTION_ID;

  // Auto-focus textarea when "Other" is selected
  const [textareaRef, setTextareaRef] = useState<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (isOtherSelected && textareaRef) textareaRef.focus();
  }, [isOtherSelected, textareaRef]);

  const isBlocker = decision.severity === 'blocker';
  const severityColor = isBlocker
    ? 'border-destructive/40 bg-destructive/5'
    : 'border-amber-500/40 bg-amber-500/5';
  const SeverityIcon = isBlocker ? ShieldAlert : AlertTriangle;
  const severityLabel = isBlocker ? 'Blocker' : 'High Impact';
  const severityBadgeClass = isBlocker
    ? 'bg-destructive/20 text-destructive border-destructive/30'
    : 'bg-amber-500/20 text-amber-400 border-amber-500/30';

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${severityColor}`}>
      <div className="flex items-center gap-1.5">
        <SeverityIcon className={`h-3.5 w-3.5 ${isBlocker ? 'text-destructive' : 'text-amber-500'}`} />
        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${severityBadgeClass}`}>{severityLabel}</Badge>
        {selectedOptionId && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/40 text-primary bg-primary/10">
            ✓ Selected
          </Badge>
        )}
        {isBlocker && !selectedOptionId && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 border-destructive/40 text-destructive bg-destructive/10">
            Required
          </Badge>
        )}
      </div>

      <p className="text-[11px] text-foreground leading-relaxed">{decision.note}</p>

      <div className="space-y-1.5">
        {decision.options.map((opt) => (
          <OptionRow
            key={opt.option_id}
            option={opt}
            isSelected={selectedOptionId === opt.option_id}
            isRecommended={recommendedId === opt.option_id}
            onSelect={() => onSelectOption(opt.option_id)}
          />
        ))}

        {/* Other — user-proposed solution */}
        <button
          onClick={() => onSelectOption(OTHER_OPTION_ID)}
          className={`w-full text-left rounded px-2.5 py-2 border transition-all ${
            isOtherSelected
              ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/30'
              : 'border-border/30 bg-muted/20 hover:border-border/60'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
              isOtherSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
            }`}>
              {isOtherSelected && <CheckCircle2 className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <Pencil className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] font-medium text-foreground">Other — suggest your own solution</span>
          </div>
        </button>

        {isOtherSelected && (
          <Textarea
            ref={setTextareaRef}
            placeholder="Describe your proposed solution… This will be assessed and applied during rewrite."
            value={customDirection || ''}
            onChange={(e) => onCustomDirection(e.target.value)}
            className="text-[10px] min-h-[60px] h-14 mt-1"
          />
        )}
      </div>
    </div>
  );
}
