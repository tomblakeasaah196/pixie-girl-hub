import { createStart, createMiddleware } from "@tanstack/react-start";

/**
 * TanStack Start instance for the stylist portal. No auth middleware at the
 * Start layer: the public surfaces need none, and the partner dashboard
 * (PR4) authenticates with the stylist JWT per request via lib/api.
 */
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("[stylist-portal] SSR error:", error);
    throw error;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
