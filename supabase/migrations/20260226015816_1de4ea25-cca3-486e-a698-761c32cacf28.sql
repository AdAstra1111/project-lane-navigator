DO $$
DECLARE
  v_user_id uuid;
  v_idea_text text;
  v_treatment_text text;
  v_chars_text text;
  v_market_text text;
BEGIN
  SELECT user_id INTO v_user_id FROM projects WHERE id = 'd84690fd-3a00-431e-9eb8-cc9a9434965f';

  v_idea_text := E'# Petals of Tokyo\n\n**Logline:** A struggling Ginza florist and a reclusive heir to a traditional tea ceremony dynasty find an unlikely connection through anonymous flower deliveries.\n\nSAKURA MIZUKI runs a failing flower shop in a quiet corner of Tokyo. One day, she receives a recurring order for ''unconventional'' bouquets from a mysterious client named KENJIRO ICHIKAWA.\n\n**Why Us:** High visual ''thirst trap'' potential through the tea ceremony/floristry aesthetic which trends well on Reels/TikTok.';
  v_treatment_text := E'# Petals of Tokyo — Treatment\n\n## World & Setting\n\nModern-day Tokyo, contrasting environments of a traditional tea house and a struggling flower shop in Ginza.\n\n## Tone & Style\n\nVisually aesthetic romance, inspired by J-pop visual styles. Intimate, quiet, with moments of intense emotional connection.\n\n## Story Engine\n\nAnonymous flower deliveries drive the initial connection and mystery.\n\n## Themes\n\n- Tradition vs. Modernity\n- The Language of Art\n- Finding Your Own Path\n- Vulnerability and Connection';
  v_chars_text := E'# Petals of Tokyo — Character Bible\n\n## Sakura Mizuki\n\n**Role:** Struggling Florist\n**Arc:** From pragmatic, cynical small business owner to someone who embraces vulnerability.\n**Flaw:** Initially guarded and prone to self-doubt.\n\n## Kenjiro Ichikawa\n\n**Role:** Reclusive Tea Heir\n**Arc:** From dutiful, emotionally stifled heir to an individual who embraces his true desires.\n**Flaw:** Overly compliant and fearful of disappointing his family.';
  v_market_text := E'# Petals of Tokyo — Market Sheet\n\n## Lane Justification\n\nFast-turnaround lane is optimal due to vertical-drama format.\n\n## Comparable Analysis\n\n### Good Morning Call\n**Relevance:** Established young adult romance audience\n\n### Atelier\n**Relevance:** Focus on craft and artistry\n\n### First Love (2022)\n**Relevance:** Aesthetically driven, emotionally resonant Japanese romance';

  INSERT INTO project_document_versions (document_id, version_number, plaintext, status, is_current, created_by)
  VALUES 
    ('ac54202d-21ab-4d93-8fd1-63285b855cb7', 1, v_idea_text, 'draft', true, v_user_id),
    ('f0a29bfa-bfb9-456f-825d-a4c2d8874850', 1, v_treatment_text, 'draft', true, v_user_id),
    ('7957e968-ed9b-4baf-833f-a6701ca9b8b6', 1, v_chars_text, 'draft', true, v_user_id),
    ('5447c3a5-03f8-4d1b-bcea-f63aea220929', 1, v_market_text, 'draft', true, v_user_id);

  UPDATE project_documents SET plaintext = v_idea_text, extracted_text = v_idea_text WHERE id = 'ac54202d-21ab-4d93-8fd1-63285b855cb7';
  UPDATE project_documents SET plaintext = v_treatment_text, extracted_text = v_treatment_text WHERE id = 'f0a29bfa-bfb9-456f-825d-a4c2d8874850';
  UPDATE project_documents SET plaintext = v_chars_text, extracted_text = v_chars_text WHERE id = '7957e968-ed9b-4baf-833f-a6701ca9b8b6';
  UPDATE project_documents SET plaintext = v_market_text, extracted_text = v_market_text WHERE id = '5447c3a5-03f8-4d1b-bcea-f63aea220929';
END $$;