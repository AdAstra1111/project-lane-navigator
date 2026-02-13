-- Allow project members to update their own documents (e.g. change doc_type label)
CREATE POLICY "Project members can update documents"
  ON public.project_documents
  FOR UPDATE
  USING (has_project_access(auth.uid(), project_id))
  WITH CHECK (has_project_access(auth.uid(), project_id));
