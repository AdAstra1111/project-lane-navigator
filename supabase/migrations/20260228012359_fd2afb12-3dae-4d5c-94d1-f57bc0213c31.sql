-- DB-level safety net: normalize format before insert/update on projects
CREATE OR REPLACE FUNCTION public.normalize_project_format()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
DECLARE
  raw text;
  normalized text;
BEGIN
  IF NEW.format IS NULL THEN
    RETURN NEW;
  END IF;
  
  raw := lower(NEW.format);
  
  -- Map decision option IDs and underscored variants to canonical hyphenated format
  normalized := CASE raw
    WHEN 'b1-a' THEN 'film'
    WHEN 'b1a' THEN 'film'
    WHEN 'b2-a' THEN 'vertical-drama'
    WHEN 'b2a' THEN 'vertical-drama'
    WHEN 'vertical_drama' THEN 'vertical-drama'
    WHEN 'tv_series' THEN 'tv-series'
    WHEN 'narrative_feature' THEN 'film'
    WHEN 'limited_series' THEN 'limited-series'
    WHEN 'short_film' THEN 'short-film'
    WHEN 'digital_series' THEN 'digital-series'
    WHEN 'documentary_series' THEN 'documentary-series'
    WHEN 'hybrid_documentary' THEN 'hybrid-documentary'
    WHEN 'anim_series' THEN 'anim-series'
    WHEN 'anim_feature' THEN 'anim-feature'
    ELSE NEW.format  -- keep original if no match
  END;
  
  NEW.format := normalized;
  RETURN NEW;
END;
$function$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_normalize_project_format ON projects;
CREATE TRIGGER trg_normalize_project_format
  BEFORE INSERT OR UPDATE OF format ON projects
  FOR EACH ROW
  EXECUTE FUNCTION normalize_project_format();