import { useState } from "react";
import { Building2, ChevronDown, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompanyProfiles, useSetActiveProfile } from "@/hooks/useCompanyProfiles";
import type { CompanyIntelligenceProfile } from "@/lib/paradox-house-mode";
import { toast } from "sonner";

interface Props {
  projectId: string;
  activeProfileId: string | null;
  activeProfile: CompanyIntelligenceProfile | null;
}

export function CompanyProfileSelector({ projectId, activeProfileId, activeProfile }: Props) {
  const { data: profiles, isLoading } = useCompanyProfiles();
  const setActive = useSetActiveProfile(projectId);

  const handleSelect = (profileId: string | null) => {
    setActive.mutate(profileId, {
      onSuccess: () => {
        toast.success(profileId ? "Company mode activated" : "Switched to Neutral mode");
      },
    });
  };

  const isActive = !!activeProfileId && !!activeProfile;

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
      isActive
        ? "border-primary/40 bg-primary/5"
        : "border-border bg-card"
    }`}>
      <Building2 className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-0 gap-1.5 font-medium text-sm hover:bg-transparent">
            {isActive ? (
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                {activeProfile.mode_name}
              </span>
            ) : (
              <span className="text-muted-foreground">Neutral Mode</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={() => handleSelect(null)}
            className={!isActive ? "bg-accent" : ""}
          >
            <span className="flex items-center gap-2">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
              Neutral Mode
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isLoading && (
            <DropdownMenuItem disabled>Loading profiles…</DropdownMenuItem>
          )}
          {profiles?.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={activeProfileId === p.id ? "bg-accent" : ""}
            >
              <span className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{p.mode_name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.company_name}</span>
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          {!isLoading && (!profiles || profiles.length === 0) && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No company profiles yet. Create one in Settings.
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isActive && (
        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 ml-auto">
          ACTIVE
        </Badge>
      )}
    </div>
  );
}
