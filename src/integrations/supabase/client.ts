import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://tzdxrhklarzccqamxbxw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZHhyaGtsYXJ6Y2NxYW14Ynh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4ODI4OTEsImV4cCI6MjA4ODQ1ODg5MX0.g5Dk0dCt-3rdNWgwlTlFw-lcCMvuwvcKx_vK1S70940";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
