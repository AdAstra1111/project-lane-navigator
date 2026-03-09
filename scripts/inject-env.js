/**
 * inject-env.js — runs before every Vite build (prebuild hook)
 * Ensures .env always points at the correct Supabase project,
 * regardless of what Lovable has written to the file.
 */
const fs = require('fs');
const path = require('path');

const CORRECT_ENV = `VITE_SUPABASE_PROJECT_ID="tzdxrhklarzccqamxbxw"
VITE_SUPABASE_URL="https://tzdxrhklarzccqamxbxw.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZHhyaGtsYXJ6Y2NxYW14Ynh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4ODI4OTEsImV4cCI6MjA4ODQ1ODg5MX0.g5Dk0dCt-3rdNWgwlTlFw-lcCMvuwvcKx_vK1S70940"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZHhyaGtsYXJ6Y2NxYW14Ynh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4ODI4OTEsImV4cCI6MjA4ODQ1ODg5MX0.g5Dk0dCt-3rdNWgwlTlFw-lcCMvuwvcKx_vK1S70940"
`;

const envPath = path.join(__dirname, '..', '.env');
const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

if (!current.includes('tzdxrhklarzccqamxbxw')) {
  fs.writeFileSync(envPath, CORRECT_ENV);
  console.log('[inject-env] ✅ .env corrected to tzdxrhklarzccqamxbxw');
} else {
  console.log('[inject-env] ✅ .env already correct');
}
