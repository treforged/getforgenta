-- Record the HANDLE the inviter typed, so `status` can echo it back instead of an email address.
--
-- ⚠️ WHY THIS EXISTS: it closes a disclosure, not a display gap. `friend-link`'s status payload
-- returned `invitee_email` raw, under a comment reading "echoes back only what this caller typed".
-- That was true while typing an address was the only way to invite. From the moment
-- `invite_username` shipped it was FALSE: that path resolves a handle to the target's mailbox and
-- writes it, so the inviter was handed back an address they had no other way to learn. The row now
-- records the handle, and that is what goes back.
--
-- ⚠️ WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: it does NOT drop `invitee_email`, and it does
-- NOT drop `friend_links_one_pending`. A resume brief asked for both. `invite_username` resolves
-- the handle and calls the SAME handler, so `invitee_email` is the delivery address AND the
-- accept-time identity check for the path that REPLACED email - not a remnant of the removed one.
-- It is NOT NULL. Dropping either breaks every username invite and every accept.
--
-- NULLABLE ON PURPOSE: rows written before today carry no handle. `null` means "not recorded",
-- and the client names such an invite generically rather than falling back to a masked address -
-- a masked address is still part of an address this caller never typed.
--
-- Undo: alter table public.friend_links drop column invitee_username;
alter table public.friend_links
  add column if not exists invitee_username text;

comment on column public.friend_links.invitee_username is
  'The handle the inviter typed. NULL for rows written before 2026-09-15. Echoed back by the '
  'friend-link status payload in place of invitee_email, which since invite_username may be an '
  'address the inviter never typed.';
