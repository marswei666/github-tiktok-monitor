# GitHub Actions TikTok Monitor

This folder contains a small GitHub Actions monitor for TikTok creator profile updates.

## Install

Copy these paths into the root of your GitHub website repository:

- `.github/workflows/tiktok-monitor.yml`
- `scripts/tiktok-monitor.mjs`
- `data/tiktok-state.json`

Then create a repository secret:

- Name: `SERVER_CHAN_SENDKEY`
- Value: your Server Chan Turbo SendKey, for example `SCT...`

GitHub path:

`Repository -> Settings -> Secrets and variables -> Actions -> New repository secret`

## How it Works

- Runs every 5 minutes through GitHub Actions.
- Checks the configured TikTok handles.
- First run only initializes state and does not push alerts.
- Later runs push to Server Chan only when a new TikTok video ID appears.
- State is committed back to `data/tiktok-state.json`.

## Notes

TikTok may block or vary public profile HTML for cloud runners. If that happens often, use a paid TikTok data API or a small VPS with a residential/proxy-capable browser runner.
# github-tiktok-monitor
