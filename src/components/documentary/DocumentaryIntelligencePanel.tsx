/**
 * Documentary Intelligence Panel — Auto-activated for documentary projects.
 * Replaces standard script coverage with Documentary Coverage Engine.
 * Includes: Grant Matching, Impact Campaign, Consent & Legal, Archive Budget.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileSearch, Shield, Users, Archive, DollarSign, Globe, AlertTriangle,
  CheckCircle2, BookOpen, Target, Landmark, Scale, Film
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/InfoTooltip';
import { GrantMatchingPanel } from './GrantMatchingPanel';
import { ImpactCampaignPanel } from './ImpactCampaignPanel';
import { ConsentLegalDashboard } from './ConsentLegalDashboard';
import { ArchiveBudgetPanel } from './ArchiveBudgetPanel';
import { DocumentaryCoveragePanel } from './DocumentaryCoveragePanel';

interface Props {
  projectId: string;
  projectTitle: string;
  format: string;
  genres: string[];
  lane?: string;
}

export function DocumentaryIntelligencePanel({ projectId, projectTitle, format, genres, lane }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Film className="h-4 w-4 text-sky-400" />
        <h4 className="font-display font-semibold text-foreground">Documentary Intelligence</h4>
        <InfoTooltip text="Reality-locked analysis engine for documentary projects. No fiction, no hallucination." />
        <Badge className="ml-auto text-[10px] bg-sky-500/15 text-sky-400 border-sky-500/30">
          REALITY-LOCKED
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        All analysis is evidence-anchored. IFFY will never invent characters, events, or outcomes.
      </p>

      {/* Evidence Legend */}
      <div className="flex items-center gap-3 mb-4 text-[10px] flex-wrap">
        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">FACT</span>
        <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">HYPOTHESIS</span>
        <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">UNKNOWN</span>
      </div>

      <Tabs defaultValue="coverage" className="w-full">
        <TabsList className="grid w-full grid-cols-5 h-8 text-[10px]">
          <TabsTrigger value="coverage" className="text-[10px] gap-1"><FileSearch className="h-3 w-3" /> Coverage</TabsTrigger>
          <TabsTrigger value="grants" className="text-[10px] gap-1"><Landmark className="h-3 w-3" /> Grants</TabsTrigger>
          <TabsTrigger value="impact" className="text-[10px] gap-1"><Globe className="h-3 w-3" /> Impact</TabsTrigger>
          <TabsTrigger value="legal" className="text-[10px] gap-1"><Scale className="h-3 w-3" /> Legal</TabsTrigger>
          <TabsTrigger value="archive" className="text-[10px] gap-1"><Archive className="h-3 w-3" /> Archive</TabsTrigger>
        </TabsList>

        <TabsContent value="coverage" className="mt-4">
          <DocumentaryCoveragePanel
            projectId={projectId}
            projectTitle={projectTitle}
            format={format}
            genres={genres}
            lane={lane}
          />
        </TabsContent>

        <TabsContent value="grants" className="mt-4">
          <GrantMatchingPanel projectId={projectId} genres={genres} />
        </TabsContent>

        <TabsContent value="impact" className="mt-4">
          <ImpactCampaignPanel projectId={projectId} />
        </TabsContent>

        <TabsContent value="legal" className="mt-4">
          <ConsentLegalDashboard projectId={projectId} />
        </TabsContent>

        <TabsContent value="archive" className="mt-4">
          <ArchiveBudgetPanel projectId={projectId} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
