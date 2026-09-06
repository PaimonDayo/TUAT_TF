# Egress audit — 2026-09-06 / Codex

Supabase current-cycle dashboard (17 Aug–17 Sep), collected through 6 Sep:
Egress 13.729 GB / 5 GB; Cached Egress 2.989 GB / 5 GB.
Summed daily service tooltips: Storage ~8.980 GB, PostgREST ~3.894 GB,
Auth ~0.824 GB, Realtime ~0.032 GB, Functions ~13 KB.
The tooltip says it includes cached traffic, but its sum matches the Egress
summary. Do not subtract cached traffic again or treat the dashboard annotation
as a reconciled accounting breakdown. These totals do not identify app routes.

## Read-only payload measurements

Production rows, serialized JSON bytes; no row contents logged or saved:

| Query | Rows | Before | After | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Active approved member directory | 64 | 64,025 | 10,698 | 83% |
| Latest non-expired tweets with authors | 30 | 56,331 | 17,553 | 69% |

Removed `record_source` and `record_fields` only from directory and tweet
author projections. Neither consumer uses practice-record configuration.
Practice records still fetch those fields for correct historical/custom labels.
Folder readers without folder-edit permission no longer fetch the directory.
RLS, authentication, feed pagination, and rendering remain in place.
These are payload reductions for these queries, not a measured percentage of
monthly billed traffic; compression, call frequency and other queries differ.

## Auth findings

Read-only admin user sample: 64 users, median serialized user 982 bytes,
maximum 1,032 bytes. This checks user payload size, not the total wire size of
every Auth endpoint, and cannot attribute the historical 0.824 GB.
The current code already excludes API routes from Proxy auth, memoizes current
profile lookup within rendering, and avoids page refresh on token refresh and
focus-triggered SIGNED_IN events. Image routes still authenticate each uncached
request; story images also query the tweet under RLS. Keep these checks.
No new Auth reduction is claimed in this change. Attribution needs actual
endpoint request counts; do not infer counts from this user-size sample.

## R2 free-tier headroom

Official reference: https://developers.cloudflare.com/r2/pricing/
Standard: 10 GB-month storage, 1 million Class A and 10 million Class B
operations monthly; Internet egress is free. Excess storage/operations are
billable, not an automatic free-tier stop.

Migration inventory: 37 objects, 17,711,786 bytes (~0.18% of 10 GB).
The app guards new uploads at 8 GB, but this is not an account billing hard cap
and concurrent uploads/other writers can exceed it. It does not cap operations.
Signing currently performs HEAD; an uncached download adds GET, normally two
Class B operations per image. Upload capacity checks use LIST (Class A).
Illustrative load: 100 people × 500 uncached images/day × 30 days × 2 operations
= 3 million Class B operations. This is a scenario, not measured usage.
At the present storage scale the capacity risk is low; operation headroom needs
actual monthly counters. Preserve private access rather than exposing images
publicly to add caching. Image bytes go directly from R2, while signing routes
still consume Vercel/Auth and sometimes DB requests.
