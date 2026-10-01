-- Closed-app widget refresh (ask e74da89c), per-user canary switch.
-- OFF for everyone by default. The app passes it to WidgetBridge.setBackgroundRefresh, which
-- schedules (or cancels) the native 6-hourly refresh on that device. A user turning it on for
-- themselves affects only their own phone, so the ordinary own-row profile policies apply.
-- Undo: alter table public.profiles drop column widget_bg_refresh;
alter table public.profiles
  add column if not exists widget_bg_refresh boolean not null default false;
