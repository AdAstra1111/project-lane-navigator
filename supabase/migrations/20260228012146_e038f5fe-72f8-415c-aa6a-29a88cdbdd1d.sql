-- Fix project with decision-option-ID stored as format
UPDATE projects 
SET format = 'vertical-drama' 
WHERE id = '8b7d50ef-c3c9-4d1f-a353-70b2ba74399b' 
  AND format = 'B1-A';