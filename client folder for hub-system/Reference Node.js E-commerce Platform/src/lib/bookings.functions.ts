/**
 * Booking server functions. Customers must be signed in to create bookings —
 * the `_authenticated` layout gates the UI route, and `requireSupabaseAuth`
 * enforces it server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createBookingInput = z.object({
  service_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480),
  location_type: z.enum(["studio", "home", "virtual"]),
  address: z
    .object({
      line1: z.string().min(2),
      city: z.string().min(2),
      state: z.string().min(1),
      country: z.string().min(2),
    })
    .nullable()
    .optional(),
  customer_name: z.string().min(2).max(120),
  customer_email: z.string().email(),
  customer_phone: z.string().min(6).max(40).optional(),
  notes: z.string().max(2000).optional(),
  deposit_amount_ngn: z.number().nonnegative().nullable().optional(),
  payment_provider: z.enum(["stripe", "paystack", "nomba"]).optional(),
});

export const createBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createBookingInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("bookings")
      .insert({
        user_id: userId,
        service_id: data.service_id,
        scheduled_at: data.scheduled_at,
        duration_minutes: data.duration_minutes,
        location_type: data.location_type,
        address: data.address ?? null,
        customer_name: data.customer_name,
        customer_email: data.customer_email,
        customer_phone: data.customer_phone ?? null,
        notes: data.notes ?? null,
        deposit_amount_ngn: data.deposit_amount_ngn ?? null,
        payment_provider: data.payment_provider ?? null,
        status: data.deposit_amount_ngn ? "pending_deposit" : "confirmed",
      })
      .select("id, status, scheduled_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("bookings")
      .select("id, service_id, scheduled_at, duration_minutes, location_type, status, deposit_paid")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
