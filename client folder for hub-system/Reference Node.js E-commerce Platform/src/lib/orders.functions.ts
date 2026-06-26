import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CancelInput = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1, "Please share a short reason.").max(1000),
  acknowledgedPolicy: z.literal(true, {
    errorMap: () => ({ message: "You must acknowledge the cancellation policy." }),
  }),
});

export const requestOrderCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CancelInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: order, error } = await supabase.rpc("request_order_cancellation", {
      _order_id: data.orderId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return order;
  });
