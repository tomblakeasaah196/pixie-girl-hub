
-- Allow a customer to request cancellation of their own order via SECURITY DEFINER RPC.
-- Status transitions to 'cancellation_requested' for active stages; the existing
-- tg_order_status_event trigger auto-logs the change for realtime.

CREATE OR REPLACE FUNCTION public.request_order_cancellation(_order_id uuid, _reason text)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42704';
  END IF;
  IF o.status NOT IN ('inquiry','confirmed','preparing') THEN
    RAISE EXCEPTION 'This order can no longer be cancelled (status: %)', o.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
     SET status = 'cancellation_requested',
         concierge_notes = COALESCE(concierge_notes || E'\n\n', '') ||
           '[Cancellation requested ' || to_char(now(),'YYYY-MM-DD HH24:MI') || '] ' || COALESCE(_reason, '(no reason provided)')
   WHERE id = _order_id
   RETURNING * INTO o;

  -- Add an explicit event with the reason (the status-change trigger also fires, but with no note)
  INSERT INTO public.order_events (order_id, status, note)
  VALUES (_order_id, 'cancellation_requested', 'Customer requested cancellation. Reason: ' || COALESCE(_reason, '—'));

  RETURN o;
END;
$$;

REVOKE ALL ON FUNCTION public.request_order_cancellation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_order_cancellation(uuid, text) TO authenticated;
