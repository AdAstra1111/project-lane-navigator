-- Allow users to delete versions they created
CREATE POLICY "Users can delete their own versions"
  ON public.project_document_versions FOR DELETE
  USING (auth.uid() = created_by);