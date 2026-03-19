/**
 * useVisualSets — Deterministic Visual Set Curation Loop.
 * Manages slot-based visual sets with evaluation-aware governance.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCallback } from 'react';

// ── Types ──

export type VisualSetStatus = 'draft' | 'autopopulated' | 'curating' | 'ready_to_lock' | 'locked' | 'stale' | 'archived';
export type SlotState = 'empty' | 'candidate_present' | 'approved' | 'needs_replacement' | 'locked';
export type ProducerDecision = 'undecided' | 'approved' | 'rejected' | 'reuse_pool';
export type EvaluationStatus = 'approved' | 'review_required' | 'flagged' | 'rejected' | 'pending' | null;

export interface VisualSet {
  id: string;
  project_id: string;
  domain: string;
  target_type: string;
  target_id: string | null;
  target_name: string;
  source_run_id: string | null;
  status: VisualSetStatus;
  required_slot_count: number;
  current_dna_version_id: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisualSetSlot {
  id: string;
  visual_set_id: string;
  slot_key: string;
  slot_label: string;
  slot_type: string;
  is_required: boolean;
  state: SlotState;
  selected_image_id: string | null;
  evaluation_status: EvaluationStatus;
  replacement_count: number;
  created_at: string;
}

export interface VisualSetCandidate {
  id: string;
  visual_set_slot_id: string;
  image_id: string;
  evaluation_id: string | null;
  selected_for_slot: boolean;
  producer_decision: ProducerDecision;
  rejection_reason: string | null;
  created_at: string;
}

// ── Slot Definitions per Domain ──

const DOMAIN_SLOTS: Record<string, { key: string; label: string; required: boolean }[]> = {
  character_identity: [
    { key: 'headshot_primary', label: 'Identity Headshot', required: true },
    { key: 'profile_angle', label: 'Identity Profile', required: false },
    { key: 'full_body_primary', label: 'Identity Full Body', required: true },
    { key: 'close_up', label: 'Close-Up', required: false },
    { key: 'medium_shot', label: 'Medium Shot', required: false },
    { key: 'emotional_variant', label: 'Emotional Variant', required: false },
  ],
  world_refs: [
    { key: 'establishing_wide', label: 'Establishing Wide', required: true },
    { key: 'atmospheric', label: 'Atmospheric', required: true },
    { key: 'detail', label: 'Detail', required: false },
    { key: 'time_variant', label: 'Time Variant', required: false },
  ],
  costume_refs: [
    { key: 'wardrobe_baseline', label: 'Wardrobe Baseline', required: true },
    { key: 'wardrobe_variant_1', label: 'Wardrobe Variant 1', required: false },
    { key: 'wardrobe_variant_2', label: 'Wardrobe Variant 2', required: false },
  ],
  poster_set: [
    { key: 'poster_primary', label: 'Primary Poster', required: true },
    { key: 'poster_variant_1', label: 'Variant 1', required: false },
    { key: 'poster_variant_2', label: 'Variant 2', required: false },
  ],
};

export function getSlotsForDomain(domain: string) {
  return DOMAIN_SLOTS[domain] || DOMAIN_SLOTS.character_identity;
}

// ── Hook ──

export function useVisualSets(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['visual-sets', projectId] });
  }, [qc, projectId]);

  // ── Query: All sets for project ──
  const setsQuery = useQuery({
    queryKey: ['visual-sets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await (supabase as any)
        .from('visual_sets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      return (data || []) as VisualSet[];
    },
    enabled: !!projectId,
  });

  // ── Fetch slots for a set (non-hook helper) ──
  const fetchSlotsForSet = useCallback(async (setId: string): Promise<VisualSetSlot[]> => {
    const { data } = await (supabase as any)
      .from('visual_set_slots')
      .select('*')
      .eq('visual_set_id', setId)
      .order('created_at', { ascending: true });
    return (data || []) as VisualSetSlot[];
  }, []);

  // ── Fetch candidates for a set (non-hook helper) ──
  const fetchCandidatesForSet = useCallback(async (setId: string): Promise<VisualSetCandidate[]> => {
    const { data: slots } = await (supabase as any)
      .from('visual_set_slots')
      .select('id')
      .eq('visual_set_id', setId);
    if (!slots?.length) return [];
    const slotIds = slots.map((s: any) => s.id);
    const { data } = await (supabase as any)
      .from('visual_set_candidates')
      .select('*')
      .in('visual_set_slot_id', slotIds)
      .order('created_at', { ascending: true });
    return (data || []) as VisualSetCandidate[];
  }, []);

  // ── Mutation: Create set with slots ──
  const createSetMutation = useMutation({
    mutationFn: async (params: {
      domain: string;
      targetType: string;
      targetId?: string | null;
      targetName: string;
      sourceRunId?: string;
      dnaVersionId?: string | null;
    }) => {
      if (!projectId) throw new Error('No project');
      const slots = getSlotsForDomain(params.domain);
      const requiredCount = slots.filter(s => s.required).length;

      const { data: set, error: setError } = await (supabase as any)
        .from('visual_sets')
        .insert({
          project_id: projectId,
          domain: params.domain,
          target_type: params.targetType,
          target_id: params.targetId || null,
          target_name: params.targetName,
          source_run_id: params.sourceRunId || null,
          status: 'draft',
          required_slot_count: requiredCount,
          current_dna_version_id: params.dnaVersionId || null,
        })
        .select()
        .single();
      if (setError) throw setError;

      // Create slots
      const slotRows = slots.map(s => ({
        visual_set_id: set.id,
        slot_key: s.key,
        slot_label: s.label,
        slot_type: 'image',
        is_required: s.required,
        state: 'empty',
      }));
      const { error: slotError } = await (supabase as any)
        .from('visual_set_slots')
        .insert(slotRows);
      if (slotError) throw slotError;

      return set as VisualSet;
    },
    onSuccess: () => { invalidate(); toast.success('Visual set created'); },
    onError: (e: Error) => toast.error(`Failed to create set: ${e.message}`),
  });

  // ── Mutation: Attach candidate to slot ──
  const attachCandidateMutation = useMutation({
    mutationFn: async (params: {
      slotId: string;
      imageId: string;
      evaluationId?: string | null;
      selectForSlot?: boolean;
    }) => {
      const { error } = await (supabase as any)
        .from('visual_set_candidates')
        .insert({
          visual_set_slot_id: params.slotId,
          image_id: params.imageId,
          evaluation_id: params.evaluationId || null,
          selected_for_slot: params.selectForSlot ?? false,
          producer_decision: 'undecided',
        });
      if (error) throw error;

      // Update slot state
      if (params.selectForSlot) {
        await (supabase as any)
          .from('visual_set_slots')
          .update({ selected_image_id: params.imageId, state: 'candidate_present' })
          .eq('id', params.slotId);
      } else {
        // At least mark as candidate_present if empty
        await (supabase as any)
          .from('visual_set_slots')
          .update({ state: 'candidate_present' })
          .eq('id', params.slotId)
          .eq('state', 'empty');
      }
    },
    onSuccess: () => invalidate(),
  });

  // ── Mutation: Select candidate for slot ──
  const selectCandidateMutation = useMutation({
    mutationFn: async (params: { slotId: string; candidateId: string; imageId: string }) => {
      // Deselect all others in this slot
      await (supabase as any)
        .from('visual_set_candidates')
        .update({ selected_for_slot: false })
        .eq('visual_set_slot_id', params.slotId);

      // Select this one
      await (supabase as any)
        .from('visual_set_candidates')
        .update({ selected_for_slot: true })
        .eq('id', params.candidateId);

      // Update slot
      await (supabase as any)
        .from('visual_set_slots')
        .update({ selected_image_id: params.imageId, state: 'candidate_present' })
        .eq('id', params.slotId);
    },
    onSuccess: () => invalidate(),
  });

  // ── Mutation: Approve All Safe ──
  const approveAllSafeMutation = useMutation({
    mutationFn: async (params: { setId: string; includeReviewRequired?: boolean }) => {
      if (!projectId) throw new Error('No project');
      
      // Get all slots with selected candidates
      const { data: slots } = await (supabase as any)
        .from('visual_set_slots')
        .select('*')
        .eq('visual_set_id', params.setId)
        .not('selected_image_id', 'is', null);
      
      if (!slots?.length) return { approved_count: 0, skipped_count: 0, skipped_reasons: ['No selected candidates'] };

      // Get the set to verify DNA version
      const { data: set } = await (supabase as any)
        .from('visual_sets')
        .select('current_dna_version_id')
        .eq('id', params.setId)
        .single();

      const imageIds = slots.map((s: any) => s.selected_image_id);
      
      // Get evaluations for selected images
      const { data: evaluations } = await (supabase as any)
        .from('image_evaluations')
        .select('*')
        .eq('project_id', projectId)
        .in('image_id', imageIds);
      
      const evalMap = new Map((evaluations || []).map((e: any) => [e.image_id, e]));

      let approvedCount = 0;
      const skippedReasons: string[] = [];

      for (const slot of slots) {
        const eval_: any = evalMap.get(slot.selected_image_id);
        
        // Skip checks
        if (!eval_) {
          skippedReasons.push(`${slot.slot_label}: no evaluation`);
          continue;
        }
        if (eval_.governance_verdict === 'rejected') {
          skippedReasons.push(`${slot.slot_label}: rejected by evaluation`);
          continue;
        }
        if (eval_.governance_verdict === 'flagged') {
          skippedReasons.push(`${slot.slot_label}: flagged — requires manual review`);
          continue;
        }
        if (eval_.governance_verdict === 'pending') {
          skippedReasons.push(`${slot.slot_label}: evaluation pending`);
          continue;
        }
        if (eval_.governance_verdict === 'review_required' && !params.includeReviewRequired) {
          skippedReasons.push(`${slot.slot_label}: review_required — enable flag to include`);
          continue;
        }
        // DNA version mismatch
        if (set?.current_dna_version_id && eval_.dna_version_id && eval_.dna_version_id !== set.current_dna_version_id) {
          skippedReasons.push(`${slot.slot_label}: DNA version mismatch`);
          continue;
        }

        // APPROVE
        await (supabase as any)
          .from('visual_set_slots')
          .update({ state: 'approved', evaluation_status: 'approved' })
          .eq('id', slot.id);

        // Mark candidate approved
        await (supabase as any)
          .from('visual_set_candidates')
          .update({ producer_decision: 'approved' })
          .eq('visual_set_slot_id', slot.id)
          .eq('selected_for_slot', true);
        
        approvedCount++;
      }

      // Check if all required slots are approved → update set status
      const { data: allSlots } = await (supabase as any)
        .from('visual_set_slots')
        .select('is_required, state')
        .eq('visual_set_id', params.setId);
      
      const requiredSlots = (allSlots || []).filter((s: any) => s.is_required);
      const allRequiredApproved = requiredSlots.every((s: any) => s.state === 'approved');

      if (allRequiredApproved && requiredSlots.length > 0) {
        await (supabase as any)
          .from('visual_sets')
          .update({ status: 'ready_to_lock' })
          .eq('id', params.setId);
      } else {
        await (supabase as any)
          .from('visual_sets')
          .update({ status: 'curating' })
          .eq('id', params.setId);
      }

      return { approved_count: approvedCount, skipped_count: skippedReasons.length, skipped_reasons: skippedReasons };
    },
    onSuccess: (result) => {
      invalidate();
      if (result.approved_count > 0) {
        toast.success(`Approved ${result.approved_count} slot(s)`);
      }
      if (result.skipped_count > 0) {
        toast.info(`Skipped ${result.skipped_count}: ${result.skipped_reasons[0]}${result.skipped_count > 1 ? ` (+${result.skipped_count - 1} more)` : ''}`);
      }
    },
    onError: (e: Error) => toast.error(`Approve failed: ${e.message}`),
  });

  // ── Mutation: Deselect slot ──
  const deselectSlotMutation = useMutation({
    mutationFn: async (params: { slotId: string; decision?: 'rejected' | 'reuse_pool' }) => {
      // Get current selected candidate
      const { data: slot } = await (supabase as any)
        .from('visual_set_slots')
        .select('selected_image_id')
        .eq('id', params.slotId)
        .single();

      if (slot?.selected_image_id) {
        // Mark candidate with decision
        const decision = params.decision || 'rejected';
        await (supabase as any)
          .from('visual_set_candidates')
          .update({ selected_for_slot: false, producer_decision: decision })
          .eq('visual_set_slot_id', params.slotId)
          .eq('selected_for_slot', true);
      }

      // Update slot
      await (supabase as any)
        .from('visual_set_slots')
        .update({
          selected_image_id: null,
          state: 'needs_replacement',
          evaluation_status: null,
          replacement_count: (supabase as any).rpc ? undefined : 0, // will be incremented
        })
        .eq('id', params.slotId);

      // Increment replacement count manually
      const { data: current } = await (supabase as any)
        .from('visual_set_slots')
        .select('replacement_count')
        .eq('id', params.slotId)
        .single();
      
      await (supabase as any)
        .from('visual_set_slots')
        .update({ replacement_count: (current?.replacement_count || 0) + 1 })
        .eq('id', params.slotId);
    },
    onSuccess: () => { invalidate(); toast.success('Slot deselected'); },
    onError: (e: Error) => toast.error(`Deselect failed: ${e.message}`),
  });

  // ── Mutation: Lock set ──
  const lockSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      if (!projectId) throw new Error('No project');

      // Validate all required slots
      const { data: slots } = await (supabase as any)
        .from('visual_set_slots')
        .select('*')
        .eq('visual_set_id', setId);

      const requiredSlots = (slots || []).filter((s: any) => s.is_required);
      
      // Check all required slots have selection and are approved
      for (const slot of requiredSlots) {
        if (!slot.selected_image_id) {
          throw new Error(`Required slot "${slot.slot_label}" has no selected image`);
        }
        if (slot.state !== 'approved') {
          throw new Error(`Required slot "${slot.slot_label}" is not approved (state: ${slot.state})`);
        }
      }

      // Check evaluations for flagged/rejected
      const selectedIds = (slots || [])
        .filter((s: any) => s.selected_image_id)
        .map((s: any) => s.selected_image_id);

      if (selectedIds.length > 0) {
        const { data: evals } = await (supabase as any)
          .from('image_evaluations')
          .select('image_id, governance_verdict')
          .eq('project_id', projectId)
          .in('image_id', selectedIds);

        for (const e of (evals || [])) {
          if (e.governance_verdict === 'flagged') {
            throw new Error(`Image in set has flagged evaluation — resolve before locking`);
          }
          if (e.governance_verdict === 'rejected') {
            throw new Error(`Image in set has rejected evaluation — replace before locking`);
          }
        }
      }

      // Check DNA version consistency
      const { data: set } = await (supabase as any)
        .from('visual_sets')
        .select('current_dna_version_id, domain')
        .eq('id', setId)
        .single();

      if (set?.domain === 'character_identity' && !set?.current_dna_version_id) {
        throw new Error('Character sets require DNA version — resolve DNA first');
      }

      // Check for stale DNA
      if (set?.current_dna_version_id) {
        const { data: dna } = await (supabase as any)
          .from('character_visual_dna')
          .select('id')
          .eq('id', set.current_dna_version_id)
          .eq('is_current', true)
          .maybeSingle();

        if (!dna) {
          throw new Error('DNA version is stale — resolve DNA and re-evaluate');
        }
      }

      const { data: session } = await supabase.auth.getSession();

      // Lock all slots
      await (supabase as any)
        .from('visual_set_slots')
        .update({ state: 'locked' })
        .eq('visual_set_id', setId)
        .in('state', ['approved', 'candidate_present']);

      // Lock set
      await (supabase as any)
        .from('visual_sets')
        .update({
          status: 'locked',
          locked_at: new Date().toISOString(),
          locked_by: session?.session?.user?.id,
        })
        .eq('id', setId);

      // Archive older sets for same target
      if (set?.domain) {
        await (supabase as any)
          .from('visual_sets')
          .update({ status: 'archived' })
          .eq('project_id', projectId)
          .eq('domain', set.domain)
          .neq('id', setId)
          .in('status', ['draft', 'autopopulated', 'curating', 'ready_to_lock', 'stale']);
      }

      return { setId };
    },
    onSuccess: () => { invalidate(); toast.success('Visual set locked — canonical output committed'); },
    onError: (e: Error) => toast.error(`Lock failed: ${e.message}`),
  });

  // ── Mutation: Mark set status ──
  const updateSetStatusMutation = useMutation({
    mutationFn: async (params: { setId: string; status: VisualSetStatus }) => {
      await (supabase as any)
        .from('visual_sets')
        .update({ status: params.status })
        .eq('id', params.setId);
    },
    onSuccess: () => invalidate(),
  });

  // ── Stale detection ──
  const checkStaleness = useCallback(async (setId: string): Promise<boolean> => {
    const { data: set } = await (supabase as any)
      .from('visual_sets')
      .select('current_dna_version_id, domain, project_id')
      .eq('id', setId)
      .single();

    if (!set?.current_dna_version_id) return false;

    // Check if DNA version is still current
    const { data: dna } = await (supabase as any)
      .from('character_visual_dna')
      .select('id')
      .eq('id', set.current_dna_version_id)
      .eq('is_current', true)
      .maybeSingle();

    if (!dna) {
      // Mark as stale
      await (supabase as any)
        .from('visual_sets')
        .update({ status: 'stale' })
        .eq('id', setId);
      return true;
    }
    return false;
  }, []);

  return {
    sets: setsQuery.data || [],
    isLoading: setsQuery.isLoading,
    useSlotsForSet,
    useCandidatesForSet,
    createSet: createSetMutation,
    attachCandidate: attachCandidateMutation,
    selectCandidate: selectCandidateMutation,
    approveAllSafe: approveAllSafeMutation,
    deselectSlot: deselectSlotMutation,
    lockSet: lockSetMutation,
    updateSetStatus: updateSetStatusMutation,
    checkStaleness,
    invalidate,
  };
}
