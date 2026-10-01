# GitHub Actions TikTok Monitor

This folder contains a small GitHub Actions monitor for TikTok creator profile updates.

## Install

Copy these paths into the root of your GitHub website repository:

- `.github/workflows/tiktok-monitor.yml`
- `scripts/tiktok-monitor.mjs`
- `data/tiktok-state.json`

Then create these repository secrets:

- Name: `SERVER_CHAN_SENDKEY`
- Value: your Server Chan Turbo SendKey, for example `SCT...`
- Name: `APIFY_TOKEN`
- Value: your Apify API token from `Apify Console -> Settings -> Integrations`

GitHub path:

`Repository -> Settings -> Secrets and variables -> Actions -> New repository secret`

## How it Works

- Requests the latest post for each profile through the Apify TikTok Scraper.
- Checks the configured TikTok handles.
- The first corrected run safely rebuilds the baseline and sends a Server Chan health notification.
- Later runs push to Server Chan only when a new TikTok video ID appears.
- State is committed back to `data/tiktok-state.json` only when it changes.

## Notes

GitHub-hosted runners are blocked by TikTok and cannot reliably read public profile posts directly. The monitor therefore requires an Apify token. GitHub scheduled workflows are also best-effort and may run hours late; use an external scheduler for time-sensitive monitoring.
# github-tiktok-monitor
