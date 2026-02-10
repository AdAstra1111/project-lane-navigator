
-- ============================================================
-- 1. Fix collaboration RLS on 12 tables
-- ============================================================

-- project_documents
DROP POLICY IF EXISTS "Users can view their own documents" ON public.project_documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON public.project_documents;
DROP POLICY IF EXISTS "Users can delete their own documents" ON public.project_documents;

CREATE POLICY "Project members can view documents" ON public.project_documents FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can insert documents" ON public.project_documents FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete documents" ON public.project_documents FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_cast
DROP POLICY IF EXISTS "Users can view their own project cast" ON public.project_cast;
DROP POLICY IF EXISTS "Users can create their own project cast" ON public.project_cast;
DROP POLICY IF EXISTS "Users can update their own project cast" ON public.project_cast;
DROP POLICY IF EXISTS "Users can delete their own project cast" ON public.project_cast;

CREATE POLICY "Project members can view cast" ON public.project_cast FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create cast" ON public.project_cast FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update cast" ON public.project_cast FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete cast" ON public.project_cast FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_partners
DROP POLICY IF EXISTS "Users can view their own project partners" ON public.project_partners;
DROP POLICY IF EXISTS "Users can create their own project partners" ON public.project_partners;
DROP POLICY IF EXISTS "Users can update their own project partners" ON public.project_partners;
DROP POLICY IF EXISTS "Users can delete their own project partners" ON public.project_partners;

CREATE POLICY "Project members can view partners" ON public.project_partners FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create partners" ON public.project_partners FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update partners" ON public.project_partners FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete partners" ON public.project_partners FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_scripts
DROP POLICY IF EXISTS "Users can view their own project scripts" ON public.project_scripts;
DROP POLICY IF EXISTS "Users can create their own project scripts" ON public.project_scripts;
DROP POLICY IF EXISTS "Users can update their own project scripts" ON public.project_scripts;
DROP POLICY IF EXISTS "Users can delete their own project scripts" ON public.project_scripts;

CREATE POLICY "Project members can view scripts" ON public.project_scripts FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create scripts" ON public.project_scripts FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update scripts" ON public.project_scripts FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete scripts" ON public.project_scripts FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_finance_scenarios
DROP POLICY IF EXISTS "Users can view their own finance scenarios" ON public.project_finance_scenarios;
DROP POLICY IF EXISTS "Users can create their own finance scenarios" ON public.project_finance_scenarios;
DROP POLICY IF EXISTS "Users can update their own finance scenarios" ON public.project_finance_scenarios;
DROP POLICY IF EXISTS "Users can delete their own finance scenarios" ON public.project_finance_scenarios;

CREATE POLICY "Project members can view finance scenarios" ON public.project_finance_scenarios FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create finance scenarios" ON public.project_finance_scenarios FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update finance scenarios" ON public.project_finance_scenarios FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete finance scenarios" ON public.project_finance_scenarios FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_hods
DROP POLICY IF EXISTS "Users can view their own project HODs" ON public.project_hods;
DROP POLICY IF EXISTS "Users can create their own project HODs" ON public.project_hods;
DROP POLICY IF EXISTS "Users can update their own project HODs" ON public.project_hods;
DROP POLICY IF EXISTS "Users can delete their own project HODs" ON public.project_hods;

CREATE POLICY "Project members can view HODs" ON public.project_hods FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create HODs" ON public.project_hods FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update HODs" ON public.project_hods FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete HODs" ON public.project_hods FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_updates
DROP POLICY IF EXISTS "Users can view their own project updates" ON public.project_updates;
DROP POLICY IF EXISTS "Users can create their own project updates" ON public.project_updates;
DROP POLICY IF EXISTS "Users can delete their own project updates" ON public.project_updates;

CREATE POLICY "Project members can view updates" ON public.project_updates FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create updates" ON public.project_updates FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete updates" ON public.project_updates FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_scenes
DROP POLICY IF EXISTS "Users can view their own scenes" ON public.project_scenes;
DROP POLICY IF EXISTS "Users can insert their own scenes" ON public.project_scenes;
DROP POLICY IF EXISTS "Users can update their own scenes" ON public.project_scenes;
DROP POLICY IF EXISTS "Users can delete their own scenes" ON public.project_scenes;

CREATE POLICY "Project members can view scenes" ON public.project_scenes FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create scenes" ON public.project_scenes FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update scenes" ON public.project_scenes FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete scenes" ON public.project_scenes FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- shoot_days
DROP POLICY IF EXISTS "Users can view their own shoot days" ON public.shoot_days;
DROP POLICY IF EXISTS "Users can insert their own shoot days" ON public.shoot_days;
DROP POLICY IF EXISTS "Users can update their own shoot days" ON public.shoot_days;
DROP POLICY IF EXISTS "Users can delete their own shoot days" ON public.shoot_days;

CREATE POLICY "Project members can view shoot days" ON public.shoot_days FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create shoot days" ON public.shoot_days FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update shoot days" ON public.shoot_days FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete shoot days" ON public.shoot_days FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- scene_schedule
DROP POLICY IF EXISTS "Users can view their own schedule" ON public.scene_schedule;
DROP POLICY IF EXISTS "Users can insert their own schedule" ON public.scene_schedule;
DROP POLICY IF EXISTS "Users can update their own schedule" ON public.scene_schedule;
DROP POLICY IF EXISTS "Users can delete their own schedule" ON public.scene_schedule;

CREATE POLICY "Project members can view schedule" ON public.scene_schedule FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create schedule" ON public.scene_schedule FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update schedule" ON public.scene_schedule FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete schedule" ON public.scene_schedule FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_incentive_scenarios
DROP POLICY IF EXISTS "Users can view their own incentive scenarios" ON public.project_incentive_scenarios;
DROP POLICY IF EXISTS "Users can create their own incentive scenarios" ON public.project_incentive_scenarios;
DROP POLICY IF EXISTS "Users can update their own incentive scenarios" ON public.project_incentive_scenarios;
DROP POLICY IF EXISTS "Users can delete their own incentive scenarios" ON public.project_incentive_scenarios;

CREATE POLICY "Project members can view incentive scenarios" ON public.project_incentive_scenarios FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create incentive scenarios" ON public.project_incentive_scenarios FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update incentive scenarios" ON public.project_incentive_scenarios FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete incentive scenarios" ON public.project_incentive_scenarios FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- project_copro_scenarios
DROP POLICY IF EXISTS "Users can view their own copro scenarios" ON public.project_copro_scenarios;
DROP POLICY IF EXISTS "Users can create their own copro scenarios" ON public.project_copro_scenarios;
DROP POLICY IF EXISTS "Users can update their own copro scenarios" ON public.project_copro_scenarios;
DROP POLICY IF EXISTS "Users can delete their own copro scenarios" ON public.project_copro_scenarios;

CREATE POLICY "Project members can view copro scenarios" ON public.project_copro_scenarios FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create copro scenarios" ON public.project_copro_scenarios FOR INSERT WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can update copro scenarios" ON public.project_copro_scenarios FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete copro scenarios" ON public.project_copro_scenarios FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- ============================================================
-- 2. Fix storage bucket collaborator access
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_document_access(_user_id uuid, _file_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id::text = split_part(_file_path, '/', 1) THEN
    RETURN true;
  END IF;
  
  RETURN EXISTS (
    SELECT 1 FROM project_documents pd
    WHERE pd.file_path = _file_path
    AND has_project_access(_user_id, pd.project_id)
  );
END;
$$;

DROP POLICY IF EXISTS "Users can view their own project documents" ON storage.objects;
CREATE POLICY "Users can view accessible project documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-documents'
  AND public.check_document_access(auth.uid(), name)
);

DROP POLICY IF EXISTS "Users can upload project documents" ON storage.objects;
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete their own project documents" ON storage.objects;
CREATE POLICY "Users can delete accessible documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'project-documents'
  AND public.check_document_access(auth.uid(), name)
);
