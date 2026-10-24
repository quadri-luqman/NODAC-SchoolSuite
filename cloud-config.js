/* NODAC SchoolSuite - cloud connection.
   Leave the two YOUR_... values as they are to run in local (single-computer) mode.
   To go online, paste your Supabase Project URL and the "anon public" key (Project Settings > API).
   The anon key is MEANT to be public: the database rules (row level security) are what protect your data.
   NEVER paste the "service_role" key here. */
window.NODAC_CONFIG = {
  supabaseUrl: 'https://tiwraklofkrifshhrwdl.supabase.co',          // e.g. https://abcdxyzcompany.supabase.co
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpd3Jha2xvZmtyaWZzaGhyd2RsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTY5NzcsImV4cCI6MjEwODQzMjk3N30._WOgHjIaxAypYVQn1y25Z76umvc1MPcpVW-PRZ49-lw'   // long text starting with eyJ...
};
