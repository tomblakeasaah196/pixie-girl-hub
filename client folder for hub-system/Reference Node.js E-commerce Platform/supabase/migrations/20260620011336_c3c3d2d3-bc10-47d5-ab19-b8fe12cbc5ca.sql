
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS preferred_contact text,
  ADD COLUMN IF NOT EXISTS concierge_notes text;

ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'inquiry';

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON public.order_events(order_id, created_at DESC);

GRANT SELECT ON public.order_events TO authenticated;
GRANT ALL ON public.order_events TO service_role;

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_events_select_own ON public.order_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_events.order_id AND o.user_id = auth.uid()));

-- Trigger: when an order is inserted, log the initial event
CREATE OR REPLACE FUNCTION public.tg_order_initial_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.order_events (order_id, status, note)
  VALUES (NEW.id, NEW.status, 'Inquiry received. Our concierge will reach out within 24 hours.');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_initial_event ON public.orders;
CREATE TRIGGER orders_initial_event
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_order_initial_event();

-- Trigger: when an order status changes, log an event
CREATE OR REPLACE FUNCTION public.tg_order_status_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, status, note)
    VALUES (NEW.id, NEW.status, NULL);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_status_event ON public.orders;
CREATE TRIGGER orders_status_event
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_order_status_event();

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
