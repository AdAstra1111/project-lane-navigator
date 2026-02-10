import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface BuyerContact {
  id: string;
  user_id: string;
  buyer_name: string;
  company: string;
  company_type: string;
  email: string;
  phone: string;
  territories: string[];
  genres_interest: string[];
  appetite_notes: string;
  relationship_status: string;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerMeeting {
  id: string;
  user_id: string;
  buyer_contact_id: string;
  project_id: string | null;
  meeting_type: string;
  meeting_date: string;
  location: string;
  notes: string;
  outcome: string;
  follow_up: string;
  created_at: string;
}

export function useBuyerContacts() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryKey = ['buyer-contacts', user?.id];

  const { data: contacts = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('buyer_contacts')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as unknown as BuyerContact[];
    },
    enabled: !!user,
  });

  const addContact = useMutation({
    mutationFn: async (input: Partial<BuyerContact>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('buyer_contacts').insert({
        user_id: user.id,
        buyer_name: input.buyer_name || '',
        company: input.company || '',
        company_type: input.company_type || '',
        email: input.email || '',
        phone: input.phone || '',
        territories: input.territories || [],
        genres_interest: input.genres_interest || [],
        appetite_notes: input.appetite_notes || '',
        relationship_status: input.relationship_status || 'new',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Contact added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<BuyerContact> & { id: string }) => {
      const { error } = await supabase.from('buyer_contacts').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('buyer_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Contact removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { contacts, isLoading, addContact, updateContact, deleteContact };
}

export function useBuyerMeetings(contactId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryKey = ['buyer-meetings', contactId];

  const { data: meetings = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!contactId || !user) return [];
      const { data, error } = await supabase
        .from('buyer_meetings')
        .select('*')
        .eq('buyer_contact_id', contactId)
        .order('meeting_date', { ascending: false });
      if (error) throw error;
      return data as unknown as BuyerMeeting[];
    },
    enabled: !!contactId && !!user,
  });

  const addMeeting = useMutation({
    mutationFn: async (input: Partial<BuyerMeeting>) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('buyer_meetings').insert({
        user_id: user.id,
        buyer_contact_id: contactId!,
        project_id: input.project_id || null,
        meeting_type: input.meeting_type || 'general',
        meeting_date: input.meeting_date || new Date().toISOString(),
        location: input.location || '',
        notes: input.notes || '',
        outcome: input.outcome || '',
        follow_up: input.follow_up || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Meeting logged'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { meetings, isLoading, addMeeting };
}
