import { createStart, createMiddleware } from "@tanstack/react-start";

/**
 * TanStack Start instance.
 *
 * The Aura reference attached a Supabase auth middleware here
 * (`attachSupabaseAuth`). That is GONE. Storefront-customer auth is the Hub's
 * own: a short-lived access JWT (in memory) + an httpOnly refresh cookie, served
 * by `src/modules/customer_auth` (guide §7). Server-side fetches forward the
 * incoming cookies to the Hub via the api client (src/lib/api.ts), so no auth
 * middleware is needed at the Start layer.
 */
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("[storefront] SSR error:", error);
    throw error;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
