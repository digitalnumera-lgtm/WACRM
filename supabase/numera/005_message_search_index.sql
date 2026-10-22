-- Optional: makes "search any message" in the inbox fast as history grows.
-- Safe to run more than once. Changes no data.
create extension if not exists pg_trgm with schema extensions;
create index if not exists monitoring_messages_content_trgm
  on public.monitoring_messages using gin (content extensions.gin_trgm_ops);
create index if not exists monitoring_threads_customer_trgm
  on public.monitoring_threads using gin (customer extensions.gin_trgm_ops);
