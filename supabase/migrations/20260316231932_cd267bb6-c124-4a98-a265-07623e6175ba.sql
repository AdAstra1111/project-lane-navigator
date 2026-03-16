
-- 1. Create narrative_engines reference table
CREATE TABLE public.narrative_engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_key TEXT UNIQUE NOT NULL,
  engine_name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.narrative_engines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read engines"
  ON public.narrative_engines
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. Seed the 12 canonical engines
INSERT INTO public.narrative_engines (engine_key, engine_name, description) VALUES
  ('outsider_defends_system', 'Outsider Defends System', 'An outsider arrives and must protect or restore an existing system, community, or order against a threat — often becoming the unlikely champion of values they did not originally share.'),
  ('survival_against_intruder', 'Survival Against Intruder', 'A contained group faces an invading force — monster, enemy, or contagion — and must survive through resourcefulness, sacrifice, and escalating danger within a confined space or situation.'),
  ('revenge_chain', 'Revenge Chain', 'A wrong triggers a quest for vengeance that escalates through a chain of retaliatory acts, testing whether justice or destruction will prevail as the avenger becomes what they hate.'),
  ('ambition_corrupts', 'Ambition Corrupts', 'A protagonist rises through talent or will, but the pursuit of power, status, or mastery gradually erodes their moral foundation — the higher they climb, the more they lose.'),
  ('forbidden_union', 'Forbidden Union', 'Two individuals form a bond (romantic, platonic, or alliance) that violates social, cultural, or institutional boundaries — forcing them to choose between love and belonging.'),
  ('investigation_reveals_rot', 'Investigation Reveals Rot', 'An investigator pursuing a specific case gradually uncovers systemic corruption that implicates the very institutions meant to provide justice, safety, or truth.'),
  ('race_against_time', 'Race Against Time', 'A deadline-driven narrative where a ticking clock compresses all action — the protagonist must achieve a critical objective before an irreversible consequence occurs.'),
  ('power_transfer_succession_struggle', 'Power Transfer / Succession Struggle', 'A leadership vacuum or transfer of authority triggers competition, betrayal, and alliance-shifting among those who seek to claim, hold, or reshape power.'),
  ('institutional_rebellion', 'Institutional Rebellion', 'An individual or group within a rigid system awakens to its injustice and mounts resistance — risking everything to challenge or overthrow the structure from within.'),
  ('false_utopia_hidden_horror', 'False Utopia / Hidden Horror', 'An apparently ideal community, system, or relationship conceals a dark truth — the protagonist gradually discovers the cost of the perfection they initially accepted or admired.'),
  ('mentor_betrayal_corrupted_guidance', 'Mentor Betrayal / Corrupted Guidance', 'A trusted authority figure — teacher, parent, leader — is revealed to be exploitative, self-serving, or destructive, forcing the protégé to break free and find their own path.'),
  ('descent_into_the_unknown', 'Descent Into the Unknown', 'A protagonist journeys — physically, psychologically, or both — into an unfamiliar and increasingly hostile realm, confronting primal fears and returning transformed or destroyed.');

-- 3. Add engine_key columns to narrative_dna_profiles
ALTER TABLE public.narrative_dna_profiles
  ADD COLUMN IF NOT EXISTS primary_engine_key TEXT REFERENCES public.narrative_engines(engine_key),
  ADD COLUMN IF NOT EXISTS secondary_engine_key TEXT REFERENCES public.narrative_engines(engine_key);
