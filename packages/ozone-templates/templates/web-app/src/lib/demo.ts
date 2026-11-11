/**
 * A ready-made account for development. Ozone turns it on in the dev container
 * (OZONE_DEMO_ACCOUNT=1), so the preview opens on the app instead of a sign-in
 * form. It is not turned on in production.
 */
export const demoAccount = {
  name: "Demo User",
  email: "demo@example.com",
  password: "demo-account",
} as const;
