// Vorlage: als config.js speichern und ausfüllen (nur für lokales Testen).
// Beim Veröffentlichen schreibt der Workflow "App veröffentlichen" config.js aus den GitHub-Secrets.
export default {
  url: 'https://DEIN-PROJEKT.supabase.co',
  anonKey: 'DEIN-ANON-KEY',   // Supabase → Project Settings → API → anon public (darf öffentlich sein)
};
