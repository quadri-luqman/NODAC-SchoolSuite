/* NODAC SchoolSuite - cloud connection.
   Leave the two YOUR_... values as they are to run in local (single-computer) mode.
   To go online, paste your Supabase Project URL and the "anon public" key (Project Settings > API).
   The anon key is MEANT to be public: the database rules (row level security) are what protect your data.
   NEVER paste the "service_role" key here. */
window.NODAC_CONFIG = {
  supabaseUrl: 'YOUR_PROJECT_URL',          // e.g. https://abcdxyzcompany.supabase.co
  supabaseAnonKey: 'YOUR_ANON_PUBLIC_KEY'   // long text starting with eyJ...
};
