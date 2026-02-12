# IFFY Lifecycle Architecture Overhaul

## Vision
Restructure IFFY from a packaging-centric tool into a **full lifecycle production intelligence system** with 6 core stages, per-stage readiness scoring, and stage-aware AI logic.

---

## Architecture Overview

### Lifecycle Stages
```
Development → Packaging → Pre-Production → Production → Post-Production → Sales & Delivery
```

### Persistent Layers (cross-stage)
- **Finance & Recoupment** — budget tracking, equity/debt structuring, tax credits, recoupment waterfall, ownership, investor reporting
- **Trends Engine** — stage-aware trend intelligence (narrative trends in Dev, talent heat in Packaging, territory incentives in Pre-Pro, platform demand in Sales)

### Master Viability Score
```
Total Project Viability = 
  Development Weight + Packaging Weight + 
  Execution Weight (Pre-Pro + Production + Post) + 
  Monetisation Weight (Sales)
```
Weights adjust dynamically by production type.

---

## Phase 1: Lifecycle Navigation & Stage Architecture
**Goal:** Replace current tab layout with lifecycle sidebar; establish 6-stage skeleton.

### Tasks
1. **Create `LifecycleStage` type & constants** in `src/lib/types.ts`
   - Stages: `development`, `packaging`, `pre-production`, `production`, `post-production`, `sales-delivery`
   - Per-stage metadata: label, icon, description, color
   - Stage ordering & gating rules

2. **Add `lifecycle_stage` column to projects table** (migration)
   - Default: `development`
   - Replaces current `pipeline_stage`

3. **Build lifecycle sidebar component** (`src/components/LifecycleSidebar.tsx`)
   - Vertical navigation with stage icons
   - Status badge per stage (locked/active/complete)
   - Readiness % and risk color coding
   - Collapse/expand support
   - Stage-gating: stages unlock when prior stage hits threshold OR producer overrides

4. **Restructure `ProjectDetail.tsx`** 
   - Replace current monolithic layout with `SidebarProvider` + `LifecycleSidebar` + stage content area
   - Route: `/projects/:id/:stage?` (default to current lifecycle_stage)
   - Each stage renders its own panel component

5. **Create stage shell components**
   - `src/components/stages/DevelopmentStage.tsx` — migrate existing creative/analysis content
   - `src/components/stages/PackagingStage.tsx` — migrate existing cast/crew/partner content
   - `src/components/stages/PreProductionStage.tsx` — migrate existing budget/schedule/incentive content
   - `src/components/stages/ProductionStage.tsx` — new (placeholder initially)
   - `src/components/stages/PostProductionStage.tsx` — new (placeholder initially)
   - `src/components/stages/SalesDeliveryStage.tsx` — migrate existing deals/recoupment/buyer content

6. **Overview Dashboard** — top-level summary showing all stage readiness scores, timeline, and delta log

---

## Phase 2: Per-Stage Readiness Engines ✅ DONE
**Goal:** Replace the 2-score system with 6 individual stage readiness scores + master viability.

### Tasks
1. **Create `src/lib/stage-readiness.ts`**
   - `calculateDevelopmentReadiness()` — script quality, IP clarity, audience clarity, commercial tension, genre positioning
   - `calculatePackagingReadiness()` — cast strength, director attachment, producer track record, commitment levels
   - `calculatePreProductionReadiness()` — budget completeness, cashflow coverage, schedule locked %, HOD hires, legal/insurance
   - `calculateProductionReadiness()` — spend vs budget, schedule adherence, risk incidents
   - `calculatePostReadiness()` — post budget adherence, VFX milestones, edit versions, delivery checklist
   - `calculateSalesReadiness()` — territory coverage, MG vs backend, delivery compliance, marketing alignment

2. **Create `src/lib/master-viability.ts`**
   - Weighted composite of all 6 stage scores
   - Production-type-specific weight profiles
   - Stage-gating logic (locked stages contribute 0)

3. **Database: `stage_readiness_history` table** (migration)
   - `project_id`, `stage`, `score`, `breakdown`, `snapshot_date`, `user_id`

4. **Per-stage readiness display component** — reusable `StageReadinessScore.tsx` with breakdown bars

5. **Migrate existing readiness logic** — map current `readiness-score.ts` categories into Development + Packaging scores

---

## Phase 3: Development Stage Intelligence ✅ DONE
**Goal:** Enhance existing creative analysis with new development-specific features.

### Tasks
1. **Development Risk Index** — composite of:
   - IP/chain-of-title risk flags
   - Genre saturation risk (from trends)
   - Comparable title performance
   - Draft improvement delta (if multiple coverage runs exist)

2. **Audience Clarity Score** — derived from:
   - Target audience specificity
   - Genre-audience alignment
   - Tone consistency (from coverage)

3. **Commercial Tension Score** — derived from:
   - Budget-to-market fit
   - Lane classification confidence
   - Comparable title commercial performance

4. **Draft-to-Draft Delta Tracking**
   - Compare coverage run scores across versions
   - Show improvement/regression sparkline

---

## Phase 4: Packaging Stage Intelligence ✅ DONE
**Goal:** Build packaging-specific scoring and delta engine.

### Tasks
1. **Packaging Delta Engine** (`src/lib/packaging-delta.ts`)
   - Calculate % change in finance probability when attachments change
   - Before/after comparison on every cast/crew/partner mutation
   - Show delta notification inline

2. **Attachment Strength Grading** (A/B/C)
   - Based on: commitment level, market value tier, territory relevance
   - Visual grade badge on each attachment

3. **Production-type-specific packaging logic**
   - Film → presale impact of cast
   - TV → showrunner + commissioner logic  
   - Commercial → brand + agency alignment
   - Documentary → access + archive rights scoring
   - Vertical Drama → platform + short-form star metrics

---

## Phase 5: Pre-Production Stage Intelligence ✅ DONE
**Goal:** Convert existing budget/schedule into formal pre-production readiness.

### Tasks
1. **Sensitivity Modelling** — "what if budget increases 10%?" impact on cashflow/recoupment
2. **Cost-Risk Heat Map** — visual per-department risk overlay
3. **Completion Bond Readiness Tracker** — checklist of bond requirements
4. **Legal & Insurance Readiness** — checklist items contributing to readiness score
5. **Department Head Hiring Tracker** — extends existing HOD system with hire status

---

## Phase 6: Production Stage (New) ✅ DONE
**Goal:** Build production monitoring capabilities.

### Tasks
1. **Database tables** (migration)
   - `production_daily_reports` — date, scenes_shot, pages_shot, notes, incidents
   - `production_cost_actuals` — department, budgeted, actual, variance
   
2. **Production Stability Score** — derived from:
   - Actual spend vs budget (per department)
   - Schedule adherence (scenes completed vs planned)
   - Risk incident count and severity

3. **Daily Report Logging UI**
4. **Overage Alert System** — auto-flag departments exceeding budget
5. **Schedule Slippage Probability** — based on completion rate trends

---

## Phase 7: Post-Production Stage (New) ✅ DONE
**Goal:** Track creative lock and delivery readiness.

### Tasks
1. **Database tables** (migration)
   - `post_milestones` — milestone_type (picture_lock, sound_mix, vfx_final, dcp, etc.), status, due_date, completed_date
   - `edit_versions` — version_label, notes, screening_score, created_at
   - `vfx_shots` — shot_id, vendor, status, due_date, complexity

2. **Post Readiness Score** — derived from:
   - Milestone completion %
   - Post budget vs actual
   - Outstanding VFX shots
   - Music licensing status
   - Delivery materials checklist

3. **Version Delta Impact Scoring** — compare screening scores across edits
4. **Delivery Risk Flags** — auto-generated based on overdue milestones

---

## Phase 8: Sales & Delivery Stage ✅ DONE
**Goal:** Enhance existing deals/recoupment into full sales intelligence.

### Tasks
1. **Revenue Probability Index** — weighted by territory, buyer type, deal stage
2. **Platform Suitability Score** — match project attributes to platform requirements
3. **Festival Strategy Optimiser** — timeline-aware festival submission planner
4. **Delivery Checklist by Buyer Type** — platform-specific technical requirements
5. **Marketing Alignment Tracker** — materials readiness per territory

---

## Phase 9: Stage-Aware Trends Engine ✅ DONE
**Goal:** Make trend intelligence contextual to the active stage.

### Tasks
1. **Stage-trend mapping**
   - Development → narrative & genre trends
   - Packaging → talent heat & buyer appetite
   - Pre-Production → territory incentives & labour conditions
   - Sales → platform demand & territory pricing

2. **Trend freshness enforcement** — auto-flag stale data per stage context
3. **Vertical drama dedicated sources** — emerging market trend feeds

---

## Phase 10: Model Accuracy & Learning ✅ DONE
**Goal:** Self-improving prediction system.

### Tasks
1. **Model Accuracy Tracker** (`model_accuracy_scores` table)
   - Track prediction vs outcome per project per stage
   - Aggregate accuracy by production type

2. **Feedback Loop** — adjust probability weights based on:
   - Financed vs rejected projects
   - Sales achieved vs projected
   - Budget overruns vs estimates

3. **Accuracy Dashboard** — visible in Trend Governance

---

## Phase 11: Brand & Onboarding Update
**Goal:** Reflect lifecycle capability in UX copy.

### Tasks
1. Update onboarding flow to reflect 6-stage lifecycle
2. Update taglines: "From Iffy to Finance-Ready, One Decision at a Time"
3. Update About/FAQ pages
4. Stage-aware tooltips and guided tutorials

---

## Implementation Rules
- **No cross-contamination**: All logic filtered by production type
- **Every attachment triggers recalculation** of relevant stage scores
- **Every score explains its drivers** (breakdown bars + tooltips)
- **Stage-gating with override**: Stages unlock at readiness threshold OR manual override
- **Backward compatible**: Existing projects get `development` as default lifecycle_stage
- **Incremental delivery**: Each phase is independently deployable

---

## Estimated Complexity
| Phase | Effort | Dependencies |
|-------|--------|-------------|
| 1. Navigation & Architecture | Large | None |
| 2. Readiness Engines | Large | Phase 1 |
| 3. Development Intelligence | Medium | Phase 2 |
| 4. Packaging Intelligence | Medium | Phase 2 |
| 5. Pre-Production Intelligence | Medium | Phase 2 |
| 6. Production Stage | Large | Phase 1 |
| 7. Post-Production Stage | Large | Phase 1 |
| 8. Sales & Delivery | Medium | Phase 1 |
| 9. Stage-Aware Trends | Medium | Phase 1 |
| 10. Model Accuracy | Medium | Phase 2 |
| 11. Brand Update | Small | Any |
