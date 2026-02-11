
CREATE OR REPLACE FUNCTION public.log_project_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _action TEXT;
  _summary TEXT;
  _section TEXT;
BEGIN
  _action := TG_OP;
  _section := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    _summary := 'Added ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (NEW.project_id, NEW.user_id, 'create', _section, TG_TABLE_NAME, NEW.id, _summary);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _summary := 'Updated ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (NEW.project_id, NEW.user_id, 'update', _section, TG_TABLE_NAME, NEW.id, _summary);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Skip logging if the parent project no longer exists (cascade delete)
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = OLD.project_id) THEN
      RETURN OLD;
    END IF;
    _summary := 'Removed ' || TG_TABLE_NAME;
    INSERT INTO public.project_activity_log (project_id, user_id, action, section, entity_type, entity_id, summary)
    VALUES (OLD.project_id, OLD.user_id, 'delete', _section, TG_TABLE_NAME, OLD.id, _summary);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;
