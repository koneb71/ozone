import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "@/db";

/** Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment. */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  // Must stay last: it copies the cookies Better Auth sets onto the response.
  plugins: [tanstackStartCookies()],
});
