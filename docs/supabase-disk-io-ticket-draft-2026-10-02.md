# DRAFT - Supabase support ticket: Disk IO budget climbing (NOT SENT)

Drafted by Ada 2026-10-02 for Sam to review. Sending it is outward-facing, so Tre or Sam sends it.
Contains no keys, no user data, and no customer emails.

---

**Subject:** Disk IO budget climbing since 2026-09-29 on project mdtosrbfkextcaezuclh; Postgres shows no I/O

**Body:**

Hello,

Our project FORGENTA (ref `mdtosrbfkextcaezuclh`, free plan) shows "about to deplete its Disk IO
Budget". The Disk IO chart in Settings > Infrastructure was near 0% from 2026-09-24 to 2026-09-28.
It then rose each day: about 40%, then 55%, then 84% on 2026-10-01. CPU is 45%, memory is 41-47%,
and disk use is 0.31 GB of 8 GB.

We measured Postgres itself on 2026-10-02 between 01:03 and 01:10 UTC. It shows almost no disk I/O:

- `pg_stat_wal`: 35 KB of WAL in 6 minutes (about 8 MB a day). Over a 15-second window, wal_write,
  wal_sync and wal_bytes did not change.
- `pg_stat_io`: client backends read 2,248 blocks in total since 2026-02-12. The cache hit rate is
  100%.
- `pg_stat_database.temp_bytes`: unchanged since 2026-09-23. No new temp files in 9 days.
- `pg_stat_checkpointer`: buffers_written flat across our readings.
- No replication slots. pg_cron runs 37 jobs a day, the same count as before 2026-09-29.

So the I/O that drives the chart does not appear to come from Postgres. Can you tell us which process
or service on this instance (Storage, Realtime, log collection, the OS or swap) has driven Disk IO
since 2026-09-29? Can you also tell us what metric the Disk IO % chart measures (IOPS or throughput)?

Thank you,
TRE Forged LLC
