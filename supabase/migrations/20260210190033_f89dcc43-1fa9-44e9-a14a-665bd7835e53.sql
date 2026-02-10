-- Allow users to view profiles of people they collaborate with
CREATE POLICY "Users can view collaborator profiles"
  ON public.profiles FOR SELECT
  USING (
    -- Fellow collaborators on shared projects
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc1
      JOIN public.project_collaborators pc2 
        ON pc1.project_id = pc2.project_id
      WHERE pc1.user_id = auth.uid()
        AND pc2.user_id = profiles.user_id
        AND pc1.status = 'accepted'
        AND pc2.status = 'accepted'
    )
    -- Owner viewing collaborator profiles, or collaborator viewing owner profile
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.project_collaborators pc
        ON p.id = pc.project_id
      WHERE (p.user_id = auth.uid() AND pc.user_id = profiles.user_id)
         OR (p.user_id = profiles.user_id AND pc.user_id = auth.uid())
    )
  );