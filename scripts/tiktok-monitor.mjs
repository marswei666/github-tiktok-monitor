import assert from "node:assert/strict";
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

const DETECTOR_VERSION = 2;
const stateFile = path.join(process.cwd(), "data", "tiktok-state.json");
const sendKey = process.env.SERVER_CHAN_SENDKEY;
const sendTestNotification = process.env.SEND_TEST_NOTIFICATION === "true";

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
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function normalizeHandle(value) {
  return String(value ?? "").replace(/^@/, "").trim().toLowerCase();
}

function addPost(posts, candidate) {
  if (!/^\d{10,}$/.test(candidate.id ?? "")) return;
  const existing = posts.get(candidate.id);
  posts.set(candidate.id, {
    id: candidate.id,
    createTime: candidate.createTime ?? existing?.createTime ?? null,
    description: candidate.description ?? existing?.description ?? "",
    displayName: candidate.displayName ?? existing?.displayName ?? "",
  });
}

function authorDetails(item) {
  if (typeof item.author === "string") {
    return { handle: item.author, displayName: "" };
  }
  if (item.author && typeof item.author === "object") {
    return {
      handle: item.author.uniqueId ?? item.author.unique_id ?? "",
      displayName: item.author.nickname ?? item.author.nickName ?? "",
    };
  }
  return { handle: item.authorName ?? "", displayName: "" };
}

function collectJsonPosts(value, handle, posts) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonPosts(item, handle, posts);
    return;
  }
  if (!value || typeof value !== "object") return;

  const { handle: authorHandle, displayName } = authorDetails(value);
  const looksLikePost =
    /^\d{10,}$/.test(String(value.id ?? "")) &&
    value.video &&
    typeof value.video === "object";

  if (looksLikePost && normalizeHandle(authorHandle) === normalizeHandle(handle)) {
    addPost(posts, {
      id: String(value.id),
      createTime: value.createTime ?? value.create_time ?? null,
      description: value.desc ?? value.description ?? "",
      displayName,
    });
  }

  for (const child of Object.values(value)) collectJsonPosts(child, handle, posts);
}

function extractEmbeddedJson(html) {
  const documents = [];
  const scripts = html.matchAll(
    /<script[^>]+id=["'](?:SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__)["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    try {
      documents.push(JSON.parse(match[1]));
    } catch {
      // Ignore incomplete challenge pages; the caller reports missing verified posts.
    }
  }
  return documents;
}

function compareVideoIdsDescending(a, b) {
  const left = BigInt(a.id);
  const right = BigInt(b.id);
  return left > right ? -1 : left < right ? 1 : 0;
}

function extractPosts(handle, html) {
  const posts = new Map();
  const normalizedHtml = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const urlPattern = new RegExp(
    `(?:https?:)?//(?:www\\.)?tiktok\\.com/@${escapedHandle}/video/(\\d{10,})|/@${escapedHandle}/video/(\\d{10,})`,
    "gi",
  );
  for (const match of normalizedHtml.matchAll(urlPattern)) {
    addPost(posts, { id: match[1] ?? match[2] });
  }
  for (const document of extractEmbeddedJson(html)) collectJsonPosts(document, handle, posts);
  return [...posts.values()].sort(compareVideoIdsDescending);
}

function pageLooksBlocked(html) {
  return ["captcha", "verify", "Access Denied", "Please wait", "Something went wrong"].some(
    (marker) => html.toLowerCase().includes(marker.toLowerCase()),
  );
}

function htmlDiagnostics(html) {
  const scriptIds = [...html.matchAll(/<script[^>]+id=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .slice(0, 8);
  return [
    `html=${html.length}`,
    `videoPaths=${(html.match(/\\?\/video\\?\//g) ?? []).length}`,
    `videoIdFields=${(html.match(/videoId/gi) ?? []).length}`,
    `itemModule=${html.includes("ItemModule")}`,
    `scriptIds=${scriptIds.join(",") || "none"}`,
  ].join("; ");
}

function workflowCommandText(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function postUrl(handle, id) {
  return `https://www.tiktok.com/@${handle}/video/${id}`;
}

function videoPublishedAt(post) {
  const explicit = Number(post.createTime);
  if (Number.isFinite(explicit) && explicit > 1_450_000_000) return new Date(explicit * 1000);
  try {
    const date = new Date(Number(BigInt(post.id) >> 32n) * 1000);
    const upperBound = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (date.getTime() > Date.UTC(2016, 0, 1) && date.getTime() < upperBound) return date;
  } catch {
    // Keep an unknown publication time when an ID cannot be decoded.
  }
  return null;
}

function formatChinaTime(date) {
  if (!date) return "页面未提供";
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function shortDescription(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "页面未提供文案";
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

async function pushWechat(title, desp) {
  if (!sendKey) throw new Error("SERVER_CHAN_SENDKEY is not configured");
  const response = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ title, desp }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ServerChan HTTP ${response.status}: ${text}`);
  try {
    const result = JSON.parse(text);
    if (result.code !== 0) throw new Error(`ServerChan rejected push: ${text}`);
  } catch (error) {
    if (error.message.startsWith("ServerChan rejected")) throw error;
  }
  console.log("ServerChan accepted the push.");
}

function notificationMarkdown(items) {
  return items
    .map((item) => {
      const name = item.displayName ? `${item.displayName}（@${item.handle}）` : `@${item.handle}`;
      return [
        `### ${name}`,
        "",
        `- 发布时间：${formatChinaTime(videoPublishedAt(item))}`,
        `- 链接：${item.url}`,
        `- 内容判断：${shortDescription(item.description)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

async function main() {
  if (sendTestNotification) {
    await pushWechat(
      "TikTok监控测试通知",
      `GitHub Actions 已连接 Server酱。\n\n测试时间：${formatChinaTime(new Date())}`,
    );
  }

  const state = await readState();
  state.creators ??= {};
  const notifications = [];
  const failures = [];
  let checkedCount = 0;
  let baselineCount = 0;
  let stateChanged = false;

  for (const handle of creators) {
    try {
      const html = await fetchProfile(handle);
      const posts = extractPosts(handle, html);
      if (posts.length === 0) {
        const reason = pageLooksBlocked(html)
          ? "no verified post IDs found; page may be blocked/challenged"
          : "no verified post IDs found";
        failures.push(`${handle}: ${reason}; ${htmlDiagnostics(html)}`);
        continue;
      }

      checkedCount += 1;
      const latest = posts[0];
      const previousState = state.creators[handle];
      const needsBaseline = previousState?.detectorVersion !== DETECTOR_VERSION;
      if (!previousState || needsBaseline) {
        state.creators[handle] = {
          latestVideoId: latest.id,
          latestUrl: postUrl(handle, latest.id),
          detectorVersion: DETECTOR_VERSION,
          baselineAt: new Date().toISOString(),
        };
        baselineCount += 1;
        stateChanged = true;
        console.log(`${handle}: detector v${DETECTOR_VERSION} baseline ${latest.id}`);
        continue;
      }

      const previousId = previousState.latestVideoId;
      const newPosts = posts.filter((post) => BigInt(post.id) > BigInt(previousId)).slice(0, 3);
      if (newPosts.length > 0) {
        for (const post of newPosts) {
          notifications.push({ ...post, handle, url: postUrl(handle, post.id) });
        }
        state.creators[handle] = {
          ...previousState,
          latestVideoId: latest.id,
          latestUrl: postUrl(handle, latest.id),
          updatedAt: new Date().toISOString(),
        };
        stateChanged = true;
      } else {
        console.log(`${handle}: no change (${previousId})`);
      }
    } catch (error) {
      failures.push(`${handle}: ${error.message}`);
    }
  }

  if (checkedCount === 0) {
    console.log(
      "All TikTok profile checks failed. TikTok may be blocking GitHub Actions runner IPs or may have changed its profile HTML.",
    );
    for (const failure of failures) console.log(`- ${failure}`);
    console.log(
      `::error title=TikTok profile parsing failed::${workflowCommandText(failures.slice(0, 6).join(" | "))}`,
    );
    process.exitCode = 1;
    return;
  }

  if (notifications.length > 0) {
    const title = notifications.length === 1
      ? `TikTok自然内容新帖：@${notifications[0].handle}`
      : `TikTok自然内容新帖：${notifications.length}条`;
    await pushWechat(title, notificationMarkdown(notifications));
  } else {
    console.log("No new TikTok posts detected.");
  }

  if (baselineCount > 0 && state.monitorVersion !== DETECTOR_VERSION) {
    await pushWechat(
      "TikTok监控修复已生效",
      [
        `已使用新版检测器建立基线：${baselineCount}/${creators.length} 个账号。`,
        `成功读取：${checkedCount} 个账号。`,
        `读取失败：${failures.length} 个账号。`,
        "后续只在确认发现新视频时推送。",
      ].join("\n\n"),
    );
    state.monitorVersion = DETECTOR_VERSION;
    stateChanged = true;
  }

  if (stateChanged) await writeState(state);
  else console.log("TikTok state is unchanged; no state file update needed.");

  if (failures.length > 0) {
    console.log("Some profiles could not be checked:");
    for (const failure of failures) console.log(`- ${failure}`);
  }
}

function selfTest() {
  const html = String.raw`
    <a href="https://www.tiktok.com/@nature.test/video/7000000000000000001">Pinned</a>
    <script id="SIGI_STATE" type="application/json">{"ItemModule":{"new":{"id":"9000000000000000001","createTime":"1760000000","desc":"Newest post","author":"nature.test","video":{}},"other":{"id":"9999999999999999999","createTime":"1760000001","author":"someone.else","video":{}},"notVideo":{"id":"9999999999999999998","author":"nature.test"}}}</script>
  `;
  const posts = extractPosts("nature.test", html);
  assert.deepEqual(posts.map((post) => post.id), ["9000000000000000001", "7000000000000000001"]);
  assert.equal(posts[0].description, "Newest post");
  console.log("Self-test passed.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
