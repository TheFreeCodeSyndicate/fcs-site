/*
 * js/config.js
 * ------------------------------------------------------------------
 * The key below is the Supabase ANON key. It is designed to be public
 * and is safe to commit — it is NOT the service-role key, and it does
 * NOT bypass Row Level Security. Everything it can reach is filtered
 * by the policies in supabase/schema.sql, which were verified against
 * the live database: anonymous visitors can read the public content
 * tables and are blocked from writing anything.
 *
 * NEVER put the service_role / secret key in this file. Anything in
 * this file is served to every visitor.
 *
 * To point the site at a different project, change the two values below
 * and run supabase/schema.sql in that project. Leaving them blank makes
 * the site run entirely from the seed data in data.js.
 * ------------------------------------------------------------------
 */
window.FCS_CONFIG = {
  supabaseUrl: "https://odkpecmcvzjakeavaqcf.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ka3BlY21jdnpqYWtlYXZhcWNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MTExNDgsImV4cCI6MjEwNjE4NzE0OH0.m6OXUYsRI_8GXpPozY8JvlzofAMWE38cOK9PkSO_q5U",

  communityName: "The Free Code Syndicate",

  // Weekday select order. Matches JavaScript Date.getDay(), which is
  // also what the class_sessions.weekday column stores.
  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],

  defaultTimezone: "Asia/Kolkata",
};
