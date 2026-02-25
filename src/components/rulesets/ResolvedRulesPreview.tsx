import React from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, FileText } from 'lucide-react';

interface Props {
  resolvedRules?: Record<string, any> | null;
  resolvedSummary?: string;
  className?: string;
}

export function ResolvedRulesPreview({ resolvedRules, resolvedSummary, className }: Props) {
  if (!resolvedRules && !resolvedSummary) return null;

  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full py-1">
        <FileText className="h-3 w-3" />
        <span>Resolved Rules</span>
        <ChevronDown className="h-3 w-3 ml-auto" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        {resolvedSummary && (
          <pre className="text-[9px] text-muted-foreground whitespace-pre-wrap bg-muted/50 p-2 rounded-md mb-2">
            {resolvedSummary}
          </pre>
        )}
        {resolvedRules && (
          <details className="text-[9px]">
            <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
              Full JSON
            </summary>
            <pre className="mt-1 text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded-md max-h-48 overflow-y-auto font-mono">
              {JSON.stringify(resolvedRules, null, 2)}
            </pre>
          </details>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
