-- Client Tracker: skip rewriting the Sheet copy when nothing in it changed.
-- Safe to run more than once. (Already applied to production on 23 Oct 2026.)
alter table public.tracker_snapshot add column if not exists data_hash text;
