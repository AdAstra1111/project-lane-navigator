/**
 * useSharePack — CRUD + link generation for Investor/Buyer Share Packs.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// ── Preset defaults ──
const INVESTOR_DEFAULTS = ['concept_brief', 'market_sheet', 'deck', 'script', 'season_master_script'];
const BUYER_DEFAULTS = ['deck', 'market_sheet', 'script', 'character_bible', 'season_master_script'];

export type PackType = 'investor' | 'buyer' | 'custom';

export interface SharePackSelection {
  doc_type: string;
  version_id?: string; // pinned version; null = use active approved
}

export interface SharePack {
  id: string;
  project_id: string;
  name: string;
  pack_type: string;
  selection: SharePackSelection[];
  include_cover: boolean;
  include_contents: boolean;
  watermark_enabled: boolean;
  watermark_text: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface SharePackLink {
  id: string;
  share_pack_id: string;
  token: string;
  password_hash: string | null;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  is_revoked: boolean;
  created_at: string;
  created_by: string;
}

export function getPresetDocTypes(packType: PackType): string[] {
  if (packType === 'investor') return INVESTOR_DEFAULTS;
  if (packType === 'buyer') return BUYER_DEFAULTS;
  return [];
}

export function useSharePack(projectId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fetch existing packs for this project
  const { data: packs = [], isLoading: packsLoading } = useQuery({
    queryKey: ['share-packs', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_share_packs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SharePack[];
    },
    enabled: !!projectId,
  });

  // Fetch links for all packs
  const packIds = packs.map(p => p.id);
  const { data: links = [] } = useQuery({
    queryKey: ['share-pack-links', projectId, packIds],
    queryFn: async () => {
      if (packIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('project_share_pack_links')
        .select('*')
        .in('share_pack_id', packIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SharePackLink[];
    },
    enabled: packIds.length > 0,
  });

  // Create pack
  const createPack = useMutation({
    mutationFn: async (input: {
      name: string;
      pack_type: PackType;
      selection: SharePackSelection[];
      watermark_enabled?: boolean;
      watermark_text?: string;
      include_cover?: boolean;
      include_contents?: boolean;
    }) => {
      const { data, error } = await (supabase as any)
        .from('project_share_packs')
        .insert({
          project_id: projectId,
          name: input.name,
          pack_type: input.pack_type,
          selection: input.selection,
          watermark_enabled: input.watermark_enabled ?? true,
          watermark_text: input.watermark_text || null,
          include_cover: input.include_cover ?? true,
          include_contents: input.include_contents ?? true,
          created_by: user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SharePack;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-packs', projectId] });
      toast.success('Share pack created');
    },
    onError: (err: any) => toast.error('Failed to create pack: ' + err.message),
  });

  // Create link for a pack
  const createLink = useMutation({
    mutationFn: async (input: {
      share_pack_id: string;
      password?: string;
      expires_in_days?: number;
      max_downloads?: number;
    }) => {
      const expiresAt = input.expires_in_days
        ? new Date(Date.now() + input.expires_in_days * 86400000).toISOString()
        : null;

      const insertData: any = {
        share_pack_id: input.share_pack_id,
        expires_at: expiresAt,
        max_downloads: input.max_downloads || null,
        created_by: user?.id,
      };

      // Simple password "hash" — in production use bcrypt in edge function
      if (input.password) {
        insertData.password_hash = btoa(input.password);
      }

      const { data, error } = await (supabase as any)
        .from('project_share_pack_links')
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;
      return data as SharePackLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-pack-links', projectId] });
      toast.success('Share link created');
    },
    onError: (err: any) => toast.error('Failed to create link: ' + err.message),
  });

  // Revoke a link
  const revokeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await (supabase as any)
        .from('project_share_pack_links')
        .update({ is_revoked: true })
        .eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-pack-links', projectId] });
      toast.success('Link revoked');
    },
  });

  // Delete a pack
  const deletePack = useMutation({
    mutationFn: async (packId: string) => {
      const { error } = await (supabase as any)
        .from('project_share_packs')
        .delete()
        .eq('id', packId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-packs', projectId] });
      toast.success('Pack deleted');
    },
  });

  return {
    packs,
    links,
    packsLoading,
    createPack,
    createLink,
    revokeLink,
    deletePack,
  };
}
