
-- Scenes extracted from scripts
CREATE TABLE public.project_scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scene_number TEXT NOT NULL,
  heading TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  int_ext TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cast_members TEXT[] NOT NULL DEFAULT '{}',
  page_count NUMERIC(5,2) DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Shoot days for scheduling
CREATE TABLE public.shoot_days (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  shoot_date DATE NOT NULL,
  day_number INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'Main Unit',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, shoot_date, unit)
);

-- Scene assignments to shoot days (the schedule)
CREATE TABLE public.scene_schedule (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES public.project_scenes(id) ON DELETE CASCADE,
  shoot_day_id UUID NOT NULL REFERENCES public.shoot_days(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  call_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled',
  dependencies UUID[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(scene_id, shoot_day_id)
);

-- Enable RLS
ALTER TABLE public.project_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shoot_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_schedule ENABLE ROW LEVEL SECURITY;

-- RLS policies for project_scenes
CREATE POLICY "Users can view their own scenes" ON public.project_scenes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own scenes" ON public.project_scenes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own scenes" ON public.project_scenes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own scenes" ON public.project_scenes FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for shoot_days
CREATE POLICY "Users can view their own shoot days" ON public.shoot_days FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own shoot days" ON public.shoot_days FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own shoot days" ON public.shoot_days FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own shoot days" ON public.shoot_days FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for scene_schedule
CREATE POLICY "Users can view their own schedule" ON public.scene_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own schedule" ON public.scene_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own schedule" ON public.scene_schedule FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own schedule" ON public.scene_schedule FOR DELETE USING (auth.uid() = user_id);

-- Updated_at triggers
CREATE TRIGGER update_project_scenes_updated_at BEFORE UPDATE ON public.project_scenes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shoot_days_updated_at BEFORE UPDATE ON public.shoot_days FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scene_schedule_updated_at BEFORE UPDATE ON public.scene_schedule FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
