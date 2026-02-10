-- Add pipeline stage to projects
ALTER TABLE public.projects 
ADD COLUMN pipeline_stage text NOT NULL DEFAULT 'development';

-- Create index for pipeline queries
CREATE INDEX idx_projects_pipeline_stage ON public.projects(pipeline_stage);