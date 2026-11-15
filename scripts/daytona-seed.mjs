// Legacy entry point retained for compatibility. Administrators are now provisioned
// through Supabase Auth; deployments never need to receive their password.
await import('../packages/db/seed.ts');
