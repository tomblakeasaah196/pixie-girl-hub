
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;
-- Policies still work because RLS evaluates as the table owner (postgres),
-- which retains EXECUTE via ownership.
