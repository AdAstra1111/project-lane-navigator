/**
 * Advanced mode project view — tabbed interface with accordions.
 * One domain visible at a time, summary cards first, deep content behind accordions.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, FileText, TrendingUp, Users,
  DollarSign, Clapperboard,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import type { Project, FullAnalysis, MonetisationLane, PipelineStage } from '@/lib/types';
import type { ReadinessResult } from '@/lib/readiness-score';
import type { MasterViabilityResult } from '@/lib/master-viability';
import type { FinanceReadinessResult } from '@/lib/finance-readiness';
import type { LifecycleStage } from '@/lib/lifecycle-stages';

// Existing stage components — lazy-loaded inside tabs
import { OverviewDashboard } from '@/components/stages/OverviewDashboard';
import { DevelopmentStage } from '@/components/stages/DevelopmentStage';
import { PackagingStage } from '@/components/stages/PackagingStage';
import { PreProductionStage } from '@/components/stages/PreProductionStage';
import { ProductionStage } from '@/components/stages/ProductionStage';
import { PostProductionStage } from '@/components/stages/PostProductionStage';
import { SalesDeliveryStage } from '@/components/stages/SalesDeliveryStage';
import { FinancingLayer } from '@/components/stages/FinancingLayer';
import { BudgetingLayer } from '@/components/stages/BudgetingLayer';
import { RecoupmentLayer } from '@/components/stages/RecoupmentLayer';
import { TrendsLayer } from '@/components/stages/TrendsLayer';
import { IntegrationHub } from '@/components/integrations/IntegrationHub';

import { Cable } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'script', label: 'Script', icon: FileText },
  { id: 'market', label: 'Market', icon: TrendingUp },
  { id: 'package', label: 'Package', icon: Users },
  { id: 'finance', label: 'Finance', icon: DollarSign },
  { id: 'production', label: 'Production', icon: Clapperboard },
  { id: 'integrations', label: 'Integrations', icon: Cable },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface Props {
  project: Project;
  projectId: string;
  // Overview
  readiness: ReadinessResult | null;
  tvReadiness: any;
  modeReadiness: any;
  isTV: boolean;
  isAlternateMode: boolean;
  scoreHistory: any[];
  nextStageGates: any;
  currentUserId: string | null;
  lifecycleStage: LifecycleStage;
  masterViability: MasterViabilityResult | null;
  // Development / Script
  analysis: FullAnalysis | null;
  hasNewAnalysis: boolean;
  insights: any;
  scripts: any[];
  currentScript: any;
  hasDocuments: boolean;
  hasScript: boolean;
  documents: any[];
  onUpload: (files: File[], scriptInfo?: any, docType?: string) => void;
  isUploading: boolean;
  scriptText: string | null;
  devReadiness: any;
  // Packaging
  cast: any[];
  hods: any[];
  scriptCharacters: any[];
  scriptCharactersLoading: boolean;
  pkgReadiness: any;
  // Pre-Production / Production
  budgets: any[];
  addBudget: any;
  deals: any[];
  financeScenarios: any[];
  scheduleMetrics: any;
  preProReadiness: any;
  prodReadiness: any;
  // Post-Production
  postReadiness: any;
  // Sales
  partners: any[];
  deliverables: any[];
  trendSignals: any[];
  salesReadiness: any;
  // Finance
  financeReadiness: FinanceReadinessResult | null;
  onIncentiveAnalysed: (v: boolean) => void;
  // Budget
  costEntries: any[];
  recoupmentScenarios?: any[];
  recoupmentTiers?: any[];
}

export function AdvancedProjectView(props: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewDashboard
            project={props.project}
            projectId={props.projectId}
            readiness={props.readiness}
            tvReadiness={props.tvReadiness}
            modeReadiness={props.modeReadiness}
            isTV={props.isTV}
            isAlternateMode={props.isAlternateMode}
            scoreHistory={props.scoreHistory}
            nextStageGates={props.nextStageGates}
            currentUserId={props.currentUserId}
            lifecycleStage={props.lifecycleStage}
            onNavigateToStage={(stage) => {
              // Map lifecycle stages to tabs
              const stageToTab: Record<string, TabId> = {
                development: 'script',
                packaging: 'package',
                'pre-production': 'production',
                production: 'production',
                'post-production': 'production',
                'sales-delivery': 'market',
              };
              setActiveTab(stageToTab[stage] || 'overview');
            }}
            masterViability={props.masterViability}
          />
        );

      case 'script':
        return (
          <DevelopmentStage
            project={props.project}
            projectId={props.projectId}
            analysis={props.analysis}
            hasNewAnalysis={props.hasNewAnalysis}
            insights={props.insights}
            scripts={props.scripts}
            currentScript={props.currentScript}
            hasDocuments={props.hasDocuments}
            hasScript={props.hasScript}
            documents={props.documents}
            onUpload={props.onUpload}
            isUploading={props.isUploading}
            scriptText={props.scriptText}
            stageReadiness={props.devReadiness}
          />
        );

      case 'market':
        return (
          <div className="space-y-4">
            <SalesDeliveryStage
              project={props.project}
              projectId={props.projectId}
              cast={props.cast}
              partners={props.partners}
              deals={props.deals}
              deliverables={props.deliverables}
              trendSignals={props.trendSignals}
              stageReadiness={props.salesReadiness}
            />
            <Accordion type="single" collapsible>
              <AccordionItem value="trends">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                    Trends Engine
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <TrendsLayer
                    project={props.project}
                    projectId={props.projectId}
                    lifecycleStage={props.lifecycleStage}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        );

      case 'package':
        return (
          <PackagingStage
            project={props.project}
            projectId={props.projectId}
            cast={props.cast}
            hods={props.hods}
            scriptCharacters={props.scriptCharacters}
            scriptCharactersLoading={props.scriptCharactersLoading}
            scriptText={props.scriptText}
            isTV={props.isTV}
            stageReadiness={props.pkgReadiness}
          />
        );

      case 'finance':
        return (
          <div className="space-y-4">
            <FinancingLayer
              project={props.project}
              projectId={props.projectId}
              financeReadiness={props.financeReadiness}
              financeScenarios={props.financeScenarios}
              onIncentiveAnalysed={props.onIncentiveAnalysed}
            />
            <Accordion type="single" collapsible>
              <AccordionItem value="budgeting">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    Budgeting
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <BudgetingLayer
                    project={props.project}
                    projectId={props.projectId}
                    budgets={props.budgets}
                    deals={props.deals}
                    financeScenarios={props.financeScenarios}
                    isTV={props.isTV}
                    shootDayCount={props.scheduleMetrics.shootDayCount || 0}
                    scriptText={props.scriptText}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="recoupment">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    Recoupment
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <RecoupmentLayer
                    projectId={props.projectId}
                    budgets={props.budgets}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        );

      case 'production':
        return (
          <div className="space-y-4">
            <PreProductionStage
              project={props.project}
              projectId={props.projectId}
              budgets={props.budgets}
              addBudget={props.addBudget}
              deals={props.deals}
              financeScenarios={props.financeScenarios}
              scheduleMetrics={props.scheduleMetrics}
              scriptText={props.scriptText}
              hods={props.hods}
              budgetLines={[]}
              onIncentiveAnalysed={props.onIncentiveAnalysed}
              stageReadiness={props.preProReadiness}
            />
            <Accordion type="single" collapsible>
              <AccordionItem value="production">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <Clapperboard className="h-3.5 w-3.5 text-primary" />
                    Production Tracking
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ProductionStage
                    projectId={props.projectId}
                    totalPlannedScenes={props.scheduleMetrics.totalScenes || 0}
                    totalShootDays={props.scheduleMetrics.shootDayCount || 0}
                    stageReadiness={props.prodReadiness}
                  />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="post-production">
                <AccordionTrigger className="text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <Clapperboard className="h-3.5 w-3.5 text-primary" />
                    Post-Production
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <PostProductionStage
                    projectId={props.projectId}
                    stageReadiness={props.postReadiness}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        );

      case 'integrations':
        return <IntegrationHub projectId={props.projectId} />;

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/40 pb-0 -mb-px">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-[1px]',
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {renderTab()}
      </motion.div>
    </div>
  );
}
