/**
 * MasterSeasonScriptPanel — Shows master season script status, out-of-date detection,
 * compile/recompile CTAs, and opens compile modal for options.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen, CheckCircle2, AlertTriangle, FileText, Loader2,
  RotateCcw, Sparkles, Clock,
} from 'lucide-react';
import type { MasterScriptStatus } from '@/hooks/useMasterSeasonScript';

interface Props {
  status: MasterScriptStatus;
  isCompiling: boolean;
  onCompile: () => void;
  onOpenCompileModal: () => void;
  onOpenMaster?: () => void;
}

export function MasterSeasonScriptPanel({
  status, isCompiling, onCompile, onOpenCompileModal, onOpenMaster,
}: Props) {
  // Not yet compiled
  if (!status.exists) {
    return (
      <Card className="border-dashed border-primary/20">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-foreground">Master Season Script</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Compile all episode scripts into a single master document for review, approval, and packaging.
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onCompile}
              disabled={isCompiling}
            >
              {isCompiling
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Sparkles className="h-3 w-3" />}
              {isCompiling ? 'Compiling…' : 'Compile Master Script'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onOpenCompileModal}
            >
              Options…
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compiled — show status
  const isStale = status.isOutOfDate;
  const changedCount = status.changedEpisodes.length;

  return (
    <Card className={isStale
      ? 'border-amber-500/30 bg-amber-500/5'
      : status.isApproved
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-border/50'
    }>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className={`h-4 w-4 ${isStale ? 'text-amber-400' : 'text-primary'}`} />
            <span className="text-xs font-medium text-foreground">Master Season Script</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status.isApproved && (
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-emerald-500/30 text-emerald-400">
                Approved
              </Badge>
            )}
            {isStale && (
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/10">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                {changedCount > 0 ? `${changedCount} ep${changedCount > 1 ? 's' : ''} changed` : 'Out of date'}
              </Badge>
            )}
          </div>
        </div>

        {/* Last compiled time */}
        {status.lastCompiledAt && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last compiled: {new Date(status.lastCompiledAt).toLocaleString()}
          </div>
        )}

        {/* Stale detail */}
        {isStale && changedCount > 0 && (
          <p className="text-[10px] text-amber-400">
            Episodes changed since last compile: {status.changedEpisodes.map(n =>
              `EP${String(n).padStart(2, '0')}`
            ).join(', ')}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isStale ? (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onCompile}
              disabled={isCompiling}
            >
              {isCompiling
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCcw className="h-3 w-3" />}
              {isCompiling ? 'Recompiling…' : 'Recompile'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={onCompile}
              disabled={isCompiling}
            >
              {isCompiling
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RotateCcw className="h-3 w-3" />}
              Recompile
            </Button>
          )}

          {onOpenMaster && status.documentId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1.5 text-primary"
              onClick={onOpenMaster}
            >
              <BookOpen className="h-3 w-3" /> Open
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={onOpenCompileModal}
          >
            Options…
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
