import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ProjectPoster {
  id: string;
  project_id: string;
  user_id: string;
  version_number: number;
  status: string;
  is_active: boolean;
  source_type: string;
  key_art_storage_path: string | null;
  key_art_public_url: string | null;
  rendered_storage_path: string | null;
  rendered_public_url: string | null;
  aspect_ratio: string;
  layout_variant: string;
  prompt_text: string | null;
  prompt_inputs: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function useProjectPosters(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-posters", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from("project_posters")
        .select("*")
        .eq("project_id", projectId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectPoster[];
    },
    enabled: !!projectId,
  });
}

export function useActivePoster(projectId: string | undefined) {
  const { data: posters, ...rest } = useProjectPosters(projectId);
  const active = posters?.find(p => p.is_active && p.status === "ready") || null;
  return { data: active, posters, ...rest };
}

export function useGeneratePoster(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.functions.invoke("generate-poster", {
        body: { project_id: projectId, mode: "generate" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      toast.success("Poster generated successfully");
    },
    onError: (err: Error) => {
      if (err.message?.includes("Rate limit")) {
        toast.error("Rate limited — please try again in a moment");
      } else if (err.message?.includes("Payment required")) {
        toast.error("Credits required — add funds to continue");
      } else {
        toast.error(`Poster generation failed: ${err.message}`);
      }
    },
  });
}

export function useSetActivePoster(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (posterId: string) => {
      if (!projectId) throw new Error("No project ID");
      // Deactivate all
      await (supabase as any)
        .from("project_posters")
        .update({ is_active: false })
        .eq("project_id", projectId);
      // Activate selected
      const { error } = await (supabase as any)
        .from("project_posters")
        .update({ is_active: true })
        .eq("id", posterId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      toast.success("Active poster updated");
    },
    onError: (err: Error) => {
      toast.error(`Failed to set active poster: ${err.message}`);
    },
  });
}

export function useUploadPosterKeyArt(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!projectId) throw new Error("No project ID");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get next version
      const { data: existing } = await (supabase as any)
        .from("project_posters")
        .select("version_number")
        .eq("project_id", projectId)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (existing?.[0]?.version_number || 0) + 1;

      // Upload file
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${projectId}/key-art/v${nextVersion}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("project-posters")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage
        .from("project-posters")
        .getPublicUrl(path);

      // Deactivate previous
      await (supabase as any)
        .from("project_posters")
        .update({ is_active: false })
        .eq("project_id", projectId);

      // Create record
      const { data, error } = await (supabase as any)
        .from("project_posters")
        .insert({
          project_id: projectId,
          user_id: user.id,
          version_number: nextVersion,
          status: "ready",
          is_active: true,
          source_type: "uploaded",
          aspect_ratio: "2:3",
          layout_variant: "cinematic-dark",
          key_art_storage_path: path,
          key_art_public_url: publicUrl,
          rendered_storage_path: path,
          rendered_public_url: publicUrl,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProjectPoster;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      toast.success("Poster uploaded successfully");
    },
    onError: (err: Error) => {
      toast.error(`Upload failed: ${err.message}`);
    },
  });
}

export function useDeletePoster(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (posterId: string) => {
      const { error } = await (supabase as any)
        .from("project_posters")
        .delete()
        .eq("id", posterId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      toast.success("Poster deleted");
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });
}
