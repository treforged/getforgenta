#!/bin/bash
# One probe: keyed auth health + a REST read that reaches Postgres. Prints OK/STALL with timings.
cd C:/Users/tvonh/Desktop/TRE-Forged/getforgenta
u=$(grep -h "^VITE_SUPABASE_URL" .env.local | head -1 | cut -d= -f2- | tr -d '"')
k=$(grep -h "^VITE_SUPABASE_PUBLISHABLE_KEY" .env.local | head -1 | cut -d= -f2- | tr -d '"')
a=$(curl -s -o /dev/null -w "%{http_code}/%{time_total}" -m 20 -H "apikey: $k" "$u/auth/v1/health" || echo "000/timeout")
r=$(curl -s -o /dev/null -w "%{http_code}/%{time_total}" -m 20 -H "apikey: $k" "$u/rest/v1/profiles?select=id&limit=1" || echo "000/timeout")
ts=$(date -u +%FT%TZ)
case "$a$r" in 200/*200/*) s=OK;; *) s=STALL;; esac
echo "$ts $s auth=$a rest=$r" | tee -a "${TMP:-/tmp}/forgenta-db-stall.log"
