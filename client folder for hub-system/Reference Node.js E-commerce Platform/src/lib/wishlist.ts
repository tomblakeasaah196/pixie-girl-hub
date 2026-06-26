import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { toast } from "sonner";

export type WishlistRow = { id: string; product_slug: string; variant: string | null; created_at: string };

export function useWishlist() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery<WishlistRow[]>({
    queryKey: ["wishlist", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wishlist_items")
        .select("id, product_slug, variant, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ slug, on }: { slug: string; on: boolean }) => {
      if (!user) throw new Error("Sign in to save pieces");
      if (on) {
        const { error } = await supabase
          .from("wishlist_items")
          .insert({ user_id: user.id, product_slug: slug });
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("wishlist_items")
          .delete()
          .eq("user_id", user.id)
          .eq("product_slug", slug);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist", user?.id] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not update wishlist"),
  });

  const slugs = new Set((query.data ?? []).map((w) => w.product_slug));
  return { items: query.data ?? [], isSaved: (slug: string) => slugs.has(slug), toggle, isLoading: query.isLoading };
}
