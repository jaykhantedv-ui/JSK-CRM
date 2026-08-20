# Cron schedules

**Vercel Cron evaluates every schedule in UTC (M-27).** The business runs on
Asia/Kolkata, which is UTC+05:30 with no daylight saving — so every entry in
`vercel.json` is the IST time in §14 shifted back five and a half hours, and the
half-hour offset means most of these land on `:30`, not on the hour.

| Job | §14 | IST | UTC cron | Why |
|---|---|---|---|---|
| `new-opportunity-sla` | 14.2 | hourly | `0 * * * *` | Hourly is hourly in both zones. |
| `daily-digest` | 14.3 | 08:30 | `0 3 * * *` | 08:30 − 5:30 = 03:00 UTC. |
| `manager-digest` | 14.4 | 09:00 | `30 3 * * *` | 09:00 − 5:30 = 03:30 UTC. |
| `owner-summary` | 14.5 | per settings | `0 * * * *` | **Hourly trigger, in-route gate — ADR-011.** |
| `maintenance` | 14.6 | 02:00 | `30 20 * * *` | 02:00 IST − 5:30 = **20:30 UTC the previous day**. |

## The owner summary is the one that is not on a schedule

A Vercel cron schedule is static: it lives in `vercel.json` and changing it is a
deployment. `owner_summary_schedule` is a **business setting** the owner may edit
at `/settings` (TODO-BD-05), and §24 exists to keep that kind of change out of the
deploy pipeline.

So the route fires **every hour** and decides for itself whether this is the hour
(`shouldSendOwnerSummary` in `automation.service.ts`). Twenty-three of those runs
return `{ processed: 0, sent: 0, failed: 0 }` — a successful run that sent
nothing, which is **not** an error and must never be reported as one.

The gate compares against the **Asia/Kolkata** hour, not the UTC hour (B-10).
Comparing UTC would send the 19:00 summary at 13:30 local.

## Authentication

Every route requires `CRON_SECRET` as `Authorization: Bearer <secret>` (§14.7).
`/api/cron/*` is exempt from the session middleware — it authenticates by shared
secret, not by cookie — and **each route validates the secret itself** through
`requireCronAuth`. A missing or wrong secret returns `401` with
`{"error":"unauthorized"}` and never a redirect: a redirect answers a scheduler
with `200` and a page of HTML, which reads as a successful run and would hide a
broken job indefinitely.

An unset `CRON_SECRET` refuses every request rather than allowing them.

## Running one by hand

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/cron/daily-digest
```

`x-cron-secret: <secret>` is accepted as an alternative header during an incident.

## Response

Every route answers `{ processed, sent, failed, durationMs }` (§14.7). A job that
throws outright answers the same shape with `failed: 1` and HTTP 500 — never a
stack trace, never a partial body.

## Email configuration

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` are both required before anything sends
(M-28). Without them the jobs run, count their attempts as failures and log the
reason — they do **not** silently report success.
