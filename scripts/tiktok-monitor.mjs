import fs from "node:fs/promises";
import path from "node:path";

const creators = [
  "javi.darnaude",
  "seanminortravels",
  "jjtrailwalker",
  "izak.pnw",
  "luckybirdie_golf",
  "janellecollazo",
  "lunaebuddies",
  "tsumugu.films",
  "beauty.nature77",
  "emcu680",
  "natsuinaka",
  "4k.journey",
  "lueur__moon",
  "leejapanlife",
  "1min.traveller",
  "hiro_film",
  "marcoandflo",
  "lamartin183",
  "ry.rai.rai",
  "kurrrree",
  "photono_gen",
  "jp.trip",
  "peaktyler",
  "meenmeen_0",
  "8k.vibe",
];

const stateFile = path.join(process.cwd(), "data", "tiktok-state.json");
const sendKey = process.env.SERVER_CHAN_SENDKEY;

async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch {
    return { creators: {}, updatedAt: null };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

async function fetchProfile(handle) {
  const response = await fetch(`https://www.tiktok.com/@${handle}`, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function extractVideoIds(handle, html) {
  const ids = [];
  const seen = new Set();
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`https?:\\\\?/\\\\?/www\\.tiktok\\.com/@${escapedHandle}/video/(\\d{10,})`, "g"),
    new RegExp(`https?:\\\\?/\\\\?/www\\.tiktok\\.com\\\\?/\\\\?/@${escapedHandle}\\\\?/video\\\\?/(\\d{10,})`, "g"),
    new RegExp(`/@${escapedHandle}/video/(\\d{10,})`, "g"),
    /\\?"id\\?":\\?"(\d{10,})\\?"/g,
    /\\?"videoId\\?":\\?"(\d{10,})\\?"/g,
    /\/video\/(\d{10,})/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const id = match[1];
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

function pageLooksBlocked(html) {
  return [
    "captcha",
    "verify",
    "Access Denied",
    "Please wait",
    "Something went wrong",
  ].some((marker) => html.toLowerCase().includes(marker.toLowerCase()));
}

function postUrl(handle, id) {
  return `https://www.tiktok.com/@${handle}/video/${id}`;
}

async function pushWechat(title, desp) {
  if (!sendKey) {
    console.log("SERVER_CHAN_SENDKEY is not configured; skipping WeChat push.");
    return;
  }

  const body = new URLSearchParams({ title, desp });
  const response = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ServerChan HTTP ${response.status}: ${text}`);
  }

  console.log(`ServerChan push response: ${text}`);
}

async function main() {
  const state = await readState();
  const notifications = [];
  const failures = [];
  let checkedCount = 0;

  for (const handle of creators) {
    try {
      const html = await fetchProfile(handle);
      const ids = extractVideoIds(handle, html);
      const previous = state.creators[handle]?.latestVideoId ?? null;

      if (ids.length === 0) {
        const reason = pageLooksBlocked(html)
          ? "no video IDs found; page may be blocked/challenged"
          : "no video IDs found";
        failures.push(`${handle}: ${reason}; html length=${html.length}`);
        continue;
      }

      checkedCount += 1;
      const latest = ids[0];
      if (!previous) {
        state.creators[handle] = {
          latestVideoId: latest,
          latestUrl: postUrl(handle, latest),
          initializedAt: new Date().toISOString(),
        };
        console.log(`${handle}: initialized with ${latest}`);
        continue;
      }

      if (latest !== previous) {
        const unseen = ids.slice(0, Math.max(1, ids.indexOf(previous))).slice(0, 3);
        for (const id of unseen) {
          notifications.push({ handle, id, url: postUrl(handle, id) });
        }

        state.creators[handle] = {
          ...state.creators[handle],
          latestVideoId: latest,
          latestUrl: postUrl(handle, latest),
          updatedAt: new Date().toISOString(),
        };
      } else {
        console.log(`${handle}: no change (${latest})`);
      }
    } catch (error) {
      failures.push(`${handle}: ${error.message}`);
    }
  }

  await writeState(state);

  if (checkedCount === 0) {
    console.log("All TikTok profile checks failed. This is usually caused by TikTok blocking GitHub Actions runner IPs or changing profile HTML.");
    console.log("Failures:");
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  if (notifications.length > 0) {
    const title =
      notifications.length === 1
        ? `TikTok自然内容新帖：@${notifications[0].handle}`
        : `TikTok自然内容新帖：${notifications.length}条`;
    const desp = notifications
      .map((item) => `### @${item.handle}\n\n- 链接：${item.url}\n- 检测时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`)
      .join("\n\n---\n\n");

    await pushWechat(title, desp);
  } else {
    console.log("No new TikTok posts detected.");
  }

  if (failures.length > 0) {
    console.log("Some profiles could not be checked:");
    for (const failure of failures) console.log(`- ${failure}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
