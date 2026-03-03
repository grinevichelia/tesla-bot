const fs = require("fs");
const cron = require("node-cron");
const cheerio = require("cheerio");
require("dotenv").config();

const { TG_BOT_TOKEN, TG_CHANNEL, SEARCH_URL } = process.env;

if (!TG_BOT_TOKEN || !TG_CHANNEL || !SEARCH_URL) {
  throw new Error("Missing env: TG_BOT_TOKEN, TG_CHANNEL, SEARCH_URL");
}

const SEEN_FILE = "./seen.json";

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-5000), null, 2));
}

async function tgSendMessage(text) {
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHANNEL,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) throw new Error(`TG send failed: ${res.status} ${await res.text()}`);
}

function extractAutoId(url) {
  const m = String(url).match(/_(\d+)\.html$/);
  return m?.[1] || null;
}

function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  return `https://auto.ria.com${href}`;
}

async function fetchListings() {
  const res = await fetch(SEARCH_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "accept-language": "uk-UA,uk;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`Search fetch failed: ${res.status} ${await res.text()}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const links = new Map();
  $('a[href*="/uk/auto_"][href$=".html"]').each((_, el) => {
    const href = $(el).attr("href");
    const url = absoluteUrl(href);
    if (!url) return;

    const id = extractAutoId(url);
    if (!id) return;

    links.set(id, url);
  });

  return [...links.entries()].map(([id, url]) => ({ id, url }));
}

async function tick() {
  const seen = loadSeen();
  const listings = await fetchListings();

  const fresh = listings.filter((x) => !seen.has(x.id));
  if (!fresh.length) {
    console.log("No new listings");
    return;
  }

  for (const item of fresh.slice(0, 10)) {
    await tgSendMessage(`🚗 Нова Tesla Model S до $13k\n${item.url}`);
    seen.add(item.id);
  }

  saveSeen(seen);
  console.log(`Sent ${Math.min(10, fresh.length)} new`);
}

tick().catch(console.error);

cron.schedule("*/5 * * * *", () => tick().catch(console.error));

console.log("Watcher started…");
