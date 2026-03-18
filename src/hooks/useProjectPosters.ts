import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { registerPosterAsCanonicalImage } from "@/lib/images/registerPosterAsCanonicalImage";

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
  render_status: "key_art_only" | "composed_preview" | "composed_final";
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

/**
 * Get a signed URL for a private-bucket storage path.
 * Returns null if path is missing or signing fails.
 */
async function getSignedUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from("project-posters")
    .createSignedUrl(storagePath, 3600); // 1 hour
  if (error) {
    console.warn("Failed to sign poster URL:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

/**
 * Hydrate poster records with fresh signed URLs (private bucket).
 */
async function hydrateSignedUrls(posters: ProjectPoster[]): Promise<ProjectPoster[]> {
  return Promise.all(
    posters.map(async (p) => {
      const [keyUrl, renderedUrl] = await Promise.all([
        getSignedUrl(p.key_art_storage_path),
        getSignedUrl(p.rendered_storage_path),
      ]);
      return {
        ...p,
        key_art_public_url: keyUrl,
        rendered_public_url: renderedUrl,
      };
    })
  );
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
      const raw = (data || []) as ProjectPoster[];
      // Hydrate with signed URLs since bucket is private
      return hydrateSignedUrls(raw);
    },
    enabled: !!projectId,
    // Signed URLs expire — refetch periodically
    staleTime: 30 * 60 * 1000, // 30 min
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
    mutationFn: async (opts?: { mode?: string; strategy_key?: string }) => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.functions.invoke("generate-poster", {
        body: { project_id: projectId, mode: opts?.mode || "generate", strategy_key: opts?.strategy_key },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      if (vars?.mode === "multi_concept") {
        toast.success("Poster concepts generated");
      } else {
        toast.success("Key art generated successfully");
      }
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
    onSuccess: async (_data, posterId) => {
      // Register as canonical poster_primary
      if (projectId) {
        const { data: poster } = await (supabase as any)
          .from('project_posters')
          .select('id, key_art_storage_path, prompt_text')
          .eq('id', posterId)
          .maybeSingle();
        if (poster?.key_art_storage_path) {
          await registerPosterAsCanonicalImage({
            projectId,
            posterId: poster.id,
            storagePath: poster.key_art_storage_path,
            promptUsed: poster.prompt_text || '',
            isPrimary: true,
            role: 'poster_primary',
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      qc.invalidateQueries({ queryKey: ["project-images", projectId] });
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

      // Deactivate previous
      await (supabase as any)
        .from("project_posters")
        .update({ is_active: false })
        .eq("project_id", projectId);

      // Create record — honest: key art only, no rendered poster
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
          key_art_public_url: null, // will be hydrated via signed URL
          rendered_storage_path: null,
          rendered_public_url: null,
          render_status: "key_art_only",
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProjectPoster;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-posters", projectId] });
      toast.success("Key art uploaded successfully");
    },
    onError: (err: Error) => {
      toast.error(`Upload failed: ${err.message}`);
    },
  });
}

/**
 * Safe poster delete:
 * 1. Fetches poster record for storage paths
 * 2. Deletes storage assets (key art + rendered if exists)
 * 3. Deletes DB row
 * 4. Reassigns active poster to most recent remaining version
 */
export function useDeletePoster(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (posterId: string) => {
      if (!projectId) throw new Error("No project ID");

      // 1. Fetch the poster to get storage paths and active state
      const { data: poster, error: fetchErr } = await (supabase as any)
        .from("project_posters")
        .select("id, key_art_storage_path, rendered_storage_path, is_active")
        .eq("id", posterId)
        .single();
      if (fetchErr) throw fetchErr;

      // 2. Clean up storage assets
      const pathsToDelete: string[] = [];
      if (poster.key_art_storage_path) pathsToDelete.push(poster.key_art_storage_path);
      if (poster.rendered_storage_path && poster.rendered_storage_path !== poster.key_art_storage_path) {
        pathsToDelete.push(poster.rendered_storage_path);
      }
      if (pathsToDelete.length > 0) {
        const { error: storageErr } = await supabase.storage
          .from("project-posters")
          .remove(pathsToDelete);
        if (storageErr) {
          console.warn("Storage cleanup partial failure:", storageErr.message);
          // Continue — don't block delete on storage cleanup failure
        }
      }

      // 3. Delete DB row
      const { error: deleteErr } = await (supabase as any)
        .from("project_posters")
        .delete()
        .eq("id", posterId);
      if (deleteErr) throw deleteErr;

      // 4. If deleted poster was active, reassign to most recent ready version
      if (poster.is_active) {
        const { data: remaining } = await (supabase as any)
          .from("project_posters")
          .select("id")
          .eq("project_id", projectId)
          .eq("status", "ready")
          .order("version_number", { ascending: false })
          .limit(1);

        if (remaining?.length > 0) {
          await (supabase as any)
            .from("project_posters")
            .update({ is_active: true })
            .eq("id", remaining[0].id);
        }
      }
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
