/**
 * Public server function to read editable site content from the database.
 * Falls back to the TypeScript defaults in `site-content.ts` when no
 * override row exists. Studio will write rows here later.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const inputSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(64),
});

export const getSiteContent = createServerFn({ method: "POST" })
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<Record<string, string>> => {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { data: rows, error } = await supabase
      .from("site_content_overrides")
      .select("key, value")
      .in("key", data.keys);

    if (error) {
      console.warn("[site-content] override read failed:", error.message);
      return {};
    }
    // Serialize values as JSON strings to keep the server-fn return type simple.
    const out: Record<string, string> = {};
    for (const row of rows ?? []) out[row.key] = JSON.stringify(row.value);
    return out;
  });
