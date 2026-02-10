
-- Notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'info', -- comment, trend_match, incentive_update, system
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  link TEXT NOT NULL DEFAULT '',
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Service/triggers can insert notifications for any user
CREATE POLICY "Service can create notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index for fast lookup
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read) WHERE read = false;

-- Trigger: notify project owner when a comment is posted
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS TRIGGER AS $$
DECLARE
  _project_title TEXT;
  _project_owner UUID;
BEGIN
  SELECT title, user_id INTO _project_title, _project_owner
  FROM public.projects WHERE id = NEW.project_id;

  -- Don't notify if commenting on own project
  IF _project_owner IS NOT NULL AND _project_owner != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, project_id, link)
    VALUES (
      _project_owner,
      'comment',
      'New comment on ' || _project_title,
      LEFT(NEW.content, 120),
      NEW.project_id,
      '/projects/' || NEW.project_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON public.project_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_comment();

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
