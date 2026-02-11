
-- Trigger function: notify on deal milestone changes
CREATE OR REPLACE FUNCTION public.notify_deal_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _project_title TEXT;
  _project_owner UUID;
  _old_status TEXT;
  _amount_display TEXT;
BEGIN
  _old_status := COALESCE(OLD.status, '');
  
  -- Only fire on status changes
  IF _old_status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, user_id INTO _project_title, _project_owner
  FROM public.projects WHERE id = NEW.project_id;

  -- Format amount for display
  IF NEW.minimum_guarantee != '' THEN
    _amount_display := ' ($' || NEW.minimum_guarantee || ')';
  ELSE
    _amount_display := '';
  END IF;

  -- Notify on term-sheet
  IF NEW.status = 'term-sheet' AND _old_status != 'term-sheet' THEN
    INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
    VALUES (
      _project_owner,
      'deal-milestone',
      'Term sheet received — ' || COALESCE(NULLIF(NEW.territory, ''), NULLIF(NEW.buyer_name, ''), 'Deal'),
      _project_title || ': ' || COALESCE(NULLIF(NEW.buyer_name, ''), 'Unknown buyer') || _amount_display || ' reached term-sheet stage.',
      NEW.project_id,
      '/projects/' || NEW.project_id
    );
  END IF;

  -- Notify on closed
  IF NEW.status = 'closed' AND _old_status != 'closed' THEN
    -- Set closed_at if not already set
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;

    INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
    VALUES (
      _project_owner,
      'deal-milestone',
      'Deal closed — ' || COALESCE(NULLIF(NEW.territory, ''), NULLIF(NEW.buyer_name, ''), 'Deal'),
      _project_title || ': ' || COALESCE(NULLIF(NEW.buyer_name, ''), 'Unknown') || _amount_display || ' is now closed.',
      NEW.project_id,
      '/projects/' || NEW.project_id
    );
  END IF;

  -- Notify on deal passed
  IF NEW.status = 'passed' AND _old_status != 'passed' THEN
    INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
    VALUES (
      _project_owner,
      'deal-milestone',
      'Deal passed — ' || COALESCE(NULLIF(NEW.territory, ''), NULLIF(NEW.buyer_name, ''), 'Deal'),
      _project_title || ': ' || COALESCE(NULLIF(NEW.buyer_name, ''), 'Unknown') || ' has passed.',
      NEW.project_id,
      '/projects/' || NEW.project_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Attach trigger to project_deals
CREATE TRIGGER deal_milestone_notification
BEFORE UPDATE ON public.project_deals
FOR EACH ROW
EXECUTE FUNCTION public.notify_deal_milestone();

-- Also create a function to aggregate deal totals by category for a project
CREATE OR REPLACE FUNCTION public.get_deal_finance_summary(_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'presales_total', COALESCE(SUM(CASE WHEN deal_type IN ('all-rights','presale','theatrical','streaming','broadcast','home-ent','airline') AND status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'equity_total', COALESCE(SUM(CASE WHEN deal_type IN ('equity','co-finance','studio-deal') AND status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'incentive_total', COALESCE(SUM(CASE WHEN deal_type IN ('tax-credit','rebate','cash-grant') AND status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'gap_total', COALESCE(SUM(CASE WHEN deal_type IN ('gap-finance','bridge-loan','bank-debt') AND status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'other_total', COALESCE(SUM(CASE WHEN deal_type IN ('fund-grant','broadcaster-prebuy','development-fund','deferment','in-kind','product-placement','other') AND status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'pipeline_total', COALESCE(SUM(CASE WHEN status NOT IN ('closed','passed') THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0),
    'closed_count', COUNT(*) FILTER (WHERE status = 'closed'),
    'pipeline_count', COUNT(*) FILTER (WHERE status NOT IN ('closed','passed')),
    'total_closed', COALESCE(SUM(CASE WHEN status = 'closed' THEN NULLIF(regexp_replace(minimum_guarantee, '[^0-9.]', '', 'g'), '')::numeric ELSE 0 END), 0)
  )
  FROM public.project_deals
  WHERE project_id = _project_id;
$function$;
