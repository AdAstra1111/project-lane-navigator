import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Shield, AlertTriangle, TrendingUp, Zap, Clock,
  Building2, Target, DollarSign, Package, Film
} from "lucide-react";
import type { Project } from "@/lib/types";
import {
  evaluateCompanyMode,
  calculateExecConfidence,
  type CompanyIntelligenceProfile,
  type CompanyModeFlags,
  type DevelopmentSignals,
} from "@/lib/paradox-house-mode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  project: Project;
  profile: CompanyIntelligenceProfile | null;
  devSignals?: DevelopmentSignals;
  baselineId?: string;
  savedExecConfidence?: number | null;
}

export function ParadoxHouseModePanel({ project, profile, devSignals, baselineId, savedExecConfidence }: Props) {
  const flags = evaluateCompanyMode(project, profile, devSignals);

  const [execScores, setExecScores] = useState({
    package: 5,
    finance: 5,
    strategy: 5,
    opportunity: 5,
  });
  const [saving, setSaving] = useState(false);

  const exec = calculateExecConfidence(
    execScores.package, execScores.finance, execScores.strategy, execScores.opportunity
  );

  const saveExecConfidence = async () => {
    if (!baselineId) {
      toast.error("No baseline recorded yet — add a baseline first.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("project_baselines")
      .update({
        paradox_exec_confidence: Math.round(exec.overall),
        paradox_mode_flags: flags as any,
      })
      .eq("id", baselineId);
    setSaving(false);
    if (error) toast.error("Failed to save");
    else toast.success("Exec confidence saved");
  };

  const profileName = profile?.mode_name || "Company Mode";
  const companyName = profile?.company_name || "Company";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            {profileName}
          </CardTitle>
          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
            {flags.profileActive ? "ACTIVE" : "NEUTRAL"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {flags.profileActive
            ? `Strategic calibration against ${companyName} capabilities and positioning.`
            : "Running pure neutral intelligence mode — no company bias applied."}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Risk Flags */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Flags</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <FlagBadge
              active={flags.budgetRealismCheck}
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Budget Realism Check"
              desc={flags.budgetRealismCheck
                ? `Budget exceeds ${companyName} financeable band`
                : "Within sweet spot"}
              variant="warning"
            />
            <FlagBadge
              active={flags.packagingFragilityRisk}
              icon={<Package className="h-3.5 w-3.5" />}
              label="Packaging Fragility"
              desc={flags.packagingFragilityRisk ? "Project may only work with unattainable cast" : "Packaging dependency manageable"}
              variant="warning"
            />
            <FlagBadge
              active={flags.developmentStallRisk}
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Development Stall"
              desc={flags.developmentStallRisk ? "Rewrites without structural improvement detected" : "Development progressing"}
              variant="warning"
            />
            <FlagBadge
              active={flags.prestigeRequiresFestival}
              icon={<Film className="h-3.5 w-3.5" />}
              label="Festival Strategy Required"
              desc={flags.prestigeRequiresFestival ? "Prestige project requires festival justification" : "Not required"}
              variant="info"
            />
          </div>
        </div>

        {/* Streamer Alignment */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Streamer Alignment</h4>
          <div className="flex items-center gap-2">
            {flags.streamerAlignmentBoost ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
                <TrendingUp className="h-3 w-3" /> +1 Streamer Weighting
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground gap-1">
                <Target className="h-3 w-3" /> Neutral — no streamer alignment detected
              </Badge>
            )}
          </div>
          {profile && profile.streamer_bias_list.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Aligned streamers: {profile.streamer_bias_list.join(", ")}
            </p>
          )}
        </div>

        {/* Strategic Bias Adjustments */}
        {flags.biasAdjustments.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Strategic Bias (max 10% influence)</h4>
            <div className="space-y-1">
              {flags.biasAdjustments.map((adj, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{adj.dimension}</span>
                  <span className={adj.delta > 0 ? "text-emerald-400" : "text-amber-400"}>
                    {adj.delta > 0 ? "+" : ""}{adj.delta} — {adj.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Exec Confidence Score */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Exec Confidence
            </h4>
            <span className="text-2xl font-bold text-foreground">{exec.overall}/10</span>
          </div>

          <ConfidenceSlider
            label="Realistic to Package"
            value={execScores.package}
            onChange={(v) => setExecScores(s => ({ ...s, package: v }))}
          />
          <ConfidenceSlider
            label="Realistic to Finance"
            value={execScores.finance}
            onChange={(v) => setExecScores(s => ({ ...s, finance: v }))}
          />
          <ConfidenceSlider
            label="Fit with Company Strategy"
            value={execScores.strategy}
            onChange={(v) => setExecScores(s => ({ ...s, strategy: v }))}
          />
          <ConfidenceSlider
            label="Opportunity Cost Acceptable"
            value={execScores.opportunity}
            onChange={(v) => setExecScores(s => ({ ...s, opportunity: v }))}
          />

          <Button
            size="sm"
            variant="outline"
            onClick={saveExecConfidence}
            disabled={saving || !baselineId}
            className="w-full"
          >
            {saving ? "Saving…" : "Save Exec Confidence"}
          </Button>
          {savedExecConfidence != null && (
            <p className="text-xs text-muted-foreground text-center">
              Last saved: {savedExecConfidence}/10
            </p>
          )}
        </div>

        {/* Company Profile Details */}
        {profile && (
          <>
            <Separator />
            <details className="group">
              <summary className="text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {companyName} Profile
              </summary>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Budget Range: </span>
                  £{(profile.budget_sweet_spot_min / 1_000_000).toFixed(1)}M – £{(profile.budget_sweet_spot_max / 1_000_000).toFixed(1)}M
                </div>
                <div>
                  <span className="font-medium text-foreground">Packaging: </span>
                  {profile.packaging_strength} · <span className="font-medium text-foreground">Finance: </span>
                  {profile.finance_tolerance} · <span className="font-medium text-foreground">Attachment: </span>
                  {profile.attachment_tier_range}
                </div>
                <div>
                  <span className="font-medium text-foreground">Series Track: </span>
                  {profile.series_track_record} · <span className="font-medium text-foreground">Bias Mod: </span>
                  {profile.bias_weighting_modifier}x
                </div>
                {profile.genre_bias_list.length > 0 && (
                  <div>
                    <span className="font-medium text-foreground">Genre Bias: </span>
                    {profile.genre_bias_list.join(", ")}
                  </div>
                )}
                {profile.strategic_priorities && (
                  <div>
                    <span className="font-medium text-foreground">Priorities: </span>
                    {profile.strategic_priorities}
                  </div>
                )}
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Sub-components ----

function FlagBadge({ active, icon, label, desc, variant }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  desc: string;
  variant: "warning" | "info";
}) {
  if (!active) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <span className="text-muted-foreground mt-0.5">{icon}</span>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground/70">{desc}</p>
        </div>
      </div>
    );
  }
  const colors = variant === "warning"
    ? "border-amber-500/30 bg-amber-500/10"
    : "border-blue-500/30 bg-blue-500/10";
  const iconColor = variant === "warning" ? "text-amber-400" : "text-blue-400";

  return (
    <div className={`flex items-start gap-2 rounded-md border p-2 ${colors}`}>
      <span className={`${iconColor} mt-0.5`}>{icon}</span>
      <div>
        <p className="text-xs font-medium text-foreground flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {label}
        </p>
        <p className="text-[10px] text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function ConfidenceSlider({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-foreground">{value}</span>
      </div>
      <Slider
        min={0}
        max={10}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}
