
-- Add unique constraint on (doc_set_id, sort_order) to enforce deterministic positioning
ALTER TABLE public.project_doc_set_items
  ADD CONSTRAINT uq_doc_set_items_position UNIQUE (doc_set_id, sort_order);
