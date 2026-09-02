# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## User Directives (Highest Priority)
1. **[2026-09-02] Analyse data integrations before implementing them.**
   Do instead: inspect source schema, key coverage, and merge rules, then report viability before editing application code.

## Data Integration
1. **[2026-09-02] Google Sheets tabs are accessed through the protected published URL.**
   Do instead: derive a required sheet `gid` server-side from `DATA_URL`; never place a Sheets URL in frontend configuration.
2. **[2026-09-02] Vercel static deployment exposes local fallback data.**
   Do instead: exclude protected local datasets with `.vercelignore` and require a signed HttpOnly session in every data API route.
2. **[2026-09-02] Node 24 `fetch` can terminate Vercel Dev on Google Sheets responses.**
   Do instead: use the native HTTPS helper with bounded redirect handling for server-side Sheets requests.

## Local Validation
1. **[2026-09-02] Foreground Vercel Dev sessions do not survive user turns.**
   Do instead: launch `vercel dev --listen 3000` with a hidden persistent Windows process and verify the listening port before browser tests.
