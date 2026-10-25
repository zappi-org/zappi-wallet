# Deploy

Three Cloudflare Pages projects, all deployed by GitHub Actions. No Docker, no nginx,
no tunnel for staging/nightly.

| Target | Trigger | Project (production branch) | URL |
|---|---|---|---|
| staging | push to `main` (auto) | `zappi-wallet-staging` (`main`) | wallet-staging.zappi.space |
| nightly | manual dispatch, any ref | `zappi-wallet-nightly` (`nightly`) | wallet-nightly.zappi.space |
| production | manual dispatch, version tag | `zappi-wallet` (`production`) | wallet.zappi.space |

## Staging

Nothing to do — merge to `main` deploys it.

## Nightly

Test any commit without touching staging:

```bash
gh workflow run deploy-nightly.yml -f ref=<sha|branch|tag>
```

Each deployment keeps a permanent per-commit URL
(`https://<hash>.zappi-wallet-nightly.pages.dev`) and replaces what nightly serves.

## Production

Production is never automatic. Bump the version, tag it, then deploy by hand:

```bash
# 1. version bump → PR → review → merge to main
# 2. tag that commit (recording only, does not deploy)
git checkout main && git pull
git tag -a v0.4.5 -m "v0.4.5" && git push origin v0.4.5
# 3. deploy, then approve in the run (environment `production` reviewers)
gh workflow run deploy-production.yml -f ref=v0.4.5
```

The workflow refuses to run unless the tag matches `package.json` at that commit,
so what ships is always exactly `vX.Y.Z`.

## Rollback

- Any older version: `gh workflow run deploy-production.yml -f ref=v0.4.3`
- Instant: Pages dashboard → project → Deployments → *Rollback*

## Gates (all deploys)

`bun run test:run` → `bun run build` → `check:seed-leak` → `_headers`/`_redirects`
present + CSP present → wrangler deploy. Any failure deploys nothing; the live
version stays up.

Site behavior lives in `public/_headers` (CSP, `X-Frame-Options`, cache) and
`public/_redirects` (SPA fallback). Keep `_headers` in sync with `nginx.conf`,
which still fronts the legacy prod deployment.

## One-time setup

1. `bunx wrangler@4 pages project create <name> --production-branch <branch>` for the
   three projects (or create them in the dashboard with *Direct Upload*).
2. Repo secrets: `CLOUDFLARE_API_TOKEN` (Account → Pages → Edit), `CLOUDFLARE_ACCOUNT_ID`.
3. Custom domain on each project: Pages → Custom domains.
4. Settings → Environments → `production`: Required reviewers + *Prevent self-review*.
   Create it **before** the first tag, or the first deploy skips approval.
5. Settings → Branches → `main`: require PR + approvals + `CI` status check.

## Known gap

`server-assets/bot.html` (crawler OG page) is nginx-only, so link previews for these
domains show the SPA shell without OG tags. A Pages Function can restore it.
