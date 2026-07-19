import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const POSTS_DIR = path.join(PUBLIC_DIR, "posts");
const MEDIA_DIR = path.join(PUBLIC_DIR, "media");
const SNAPSHOTS_DIR = path.join(ROOT, "snapshots");
const CONFIG_PATH = path.join(ROOT, "config", "archive.config.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "archive-latest.json");
const ARCHIVE_JS_PATH = path.join(DATA_DIR, "archive-latest.js");
const STATUS_PATH = path.join(DATA_DIR, "status.json");
const HEARTBEAT_PATH = path.join(ROOT, "automation-heartbeat.txt");

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

const KNOWN_TOMBSTONES = [
  {
    id: "missing-2012-11-sparkles",
    title: "Sparkles",
    originalTitle: "Sparkles",
    published: "2012-11-09",
    year: 2012,
    month: 11,
    day: 9,
    url: "",
    originalUrl: "",
    archiveUrl: "",
    image: "",
    originalImage: "",
    imageAlt: "",
    excerpt: "",
    status: "original-unavailable",
    note: "The original Authors Electric post had already been deleted before this automated archive was created.",
    sources: ["known-historical-record"]
  }
];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function key(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function decodeHtml(value) {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    hellip: "…"
  };
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}

function stripTags(value) {
  return clean(decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " ")));
}

function cleanTitle(value) {
  return clean(value)
    .replace(/\s*(?:[-–—]{1,2}\s*)?by\s+julia\s+jones\s*$/i, "")
    .replace(/\s*(?:[-–—]{1,2}\s*)?julia\s+jones\s*$/i, "")
    .trim();
}

function isoDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateParts(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { iso, year, month, day };
}

function slugFromUrl(url, fallback = "post") {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || fallback;
    return filename.replace(/\.html?$/i, "") || fallback;
  } catch {
    return fallback;
  }
}

export function canonicalBlogspotUrl(input, base = "https://authorselectric.blogspot.com") {
  const raw = clean(input);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return "";
  }

  let hostname = url.hostname.toLowerCase();
  if (/^(?:www\.)?authorselectric\.blogspot\./i.test(hostname)) {
    hostname = "authorselectric.blogspot.com";
  }

  url.protocol = "https:";
  url.hostname = hostname;
  url.port = "";
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return url.toString();
}

function canonicalImageUrl(input, base = "https://authorselectric.blogspot.com") {
  const raw = clean(input);
  if (!raw || /^data:/i.test(raw)) return "";
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw, base);
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function getAttribute(tag, name) {
  const expression = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag).match(expression);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function largestSrcset(value) {
  const candidates = String(value ?? "").split(",").map((item) => {
    const match = item.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
    if (!match) return null;
    return { url: match[1], score: Number(match[2] || 1) };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function imageFromTag(tag) {
  const attributes = ["data-original", "data-src", "data-lazy-src", "data-url", "src"];
  for (const attribute of attributes) {
    const value = getAttribute(tag, attribute);
    if (value && !/^data:/i.test(value)) return canonicalImageUrl(value);
  }
  const srcset = getAttribute(tag, "srcset") || getAttribute(tag, "data-srcset");
  return canonicalImageUrl(largestSrcset(srcset));
}

function firstImageFromHtml(html) {
  const tags = String(html ?? "").match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const url = imageFromTag(tag);
    if (!url) continue;
    if (/blogger_logo|icon|avatar|profile/i.test(url)) continue;
    return {
      url,
      alt: clean(decodeHtml(getAttribute(tag, "alt") || getAttribute(tag, "title")))
    };
  }
  return { url: "", alt: "" };
}

function excerptFromHtml(html, maximum = 330) {
  const text = stripTags(
    String(html ?? "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<img\b[^>]*>/gi, " ")
  );
  if (!text) return "";
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum + 1).replace(/\s+\S*$/, "").trim()}…`;
}

function alternateLink(entry) {
  const links = Array.isArray(entry?.link) ? entry.link : [];
  const alternate = links.find((item) => item?.rel === "alternate" && item?.href);
  return alternate?.href || "";
}

function bloggerPostId(entry) {
  const id = clean(entry?.id?.$t);
  const match = id.match(/post-(\d+)$/);
  return match ? match[1] : id;
}

export function normaliseBloggerEntry(entry, source = "blogger-label") {
  if (!entry) return null;
  const originalTitle = clean(entry?.title?.$t);
  const title = cleanTitle(originalTitle);
  const originalUrl = alternateLink(entry);
  const url = canonicalBlogspotUrl(originalUrl);
  const parts = dateParts(entry?.published?.$t || entry?.updated?.$t);
  if (!title || !url || !parts) return null;

  const contentHtml = String(entry?.content?.$t || entry?.summary?.$t || "");
  const image = firstImageFromHtml(contentHtml);
  const authors = (Array.isArray(entry?.author) ? entry.author : [])
    .map((item) => clean(item?.name?.$t))
    .filter(Boolean);
  const labels = (Array.isArray(entry?.category) ? entry.category : [])
    .map((item) => clean(item?.term))
    .filter(Boolean);

  return {
    id: bloggerPostId(entry) || url,
    title,
    originalTitle,
    published: parts.iso,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    url,
    originalUrl,
    archiveUrl: "",
    image: image.url,
    originalImage: image.url,
    imageAlt: image.alt || title,
    excerpt: excerptFromHtml(contentHtml),
    status: "available",
    note: "",
    authors,
    labels,
    updated: isoDate(entry?.updated?.$t),
    contentHtml,
    sources: [source]
  };
}

function parseMonthAndYear(text, fallbackYear = 0) {
  const value = clean(text).toLowerCase();
  const yearMatch = value.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : Number(fallbackYear || 0);
  let month = 0;
  for (const [name, number] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(value)) {
      month = number;
      break;
    }
  }
  return year && month ? { year, month } : null;
}

function dateFromBlogspotUrl(url) {
  try {
    const match = new URL(url).pathname.match(/^\/(20\d{2})\/(\d{2})\//);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  } catch {
    return null;
  }
}

function legacyTitle(text, year) {
  let value = clean(text)
    .replace(/^[\s\-–—]*/, "")
    .replace(new RegExp(`^(?:${Object.keys(MONTHS).join("|")})\\.?\\s+`, "i"), "")
    .replace(new RegExp(`^${year}\\s*`, "i"), "")
    .replace(/^[“”"'‘’\s]+|[“”"'‘’\s]+$/g, "");
  return cleanTitle(value);
}

export function parseLegacyArchive(html) {
  const source = String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const records = [];
  let activeYear = 0;
  const tokenPattern = /<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = tokenPattern.exec(source))) {
    const tagName = match[1].toLowerCase();
    const attributes = match[2] || "";
    const text = stripTags(match[3]);
    if (tagName.startsWith("h")) {
      const yearMatch = text.match(/^(20\d{2})$/);
      if (yearMatch) activeYear = Number(yearMatch[1]);
      continue;
    }

    const href = getAttribute(`<a ${attributes}>`, "href");
    if (!/authorselectric\.blogspot\./i.test(href)) continue;
    const url = canonicalBlogspotUrl(href);
    if (!url) continue;
    const parsed = parseMonthAndYear(text, activeYear) || dateFromBlogspotUrl(url);
    if (!parsed) continue;
    const title = legacyTitle(text, parsed.year) || slugFromUrl(url).replace(/-/g, " ");
    const published = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-09`;
    records.push({
      id: url,
      title,
      originalTitle: text,
      published,
      year: parsed.year,
      month: parsed.month,
      day: 9,
      url,
      originalUrl: href,
      archiveUrl: "",
      image: "",
      originalImage: "",
      imageAlt: title,
      excerpt: "",
      status: "available",
      note: "",
      authors: ["Julia Jones"],
      labels: [],
      updated: "",
      sources: ["golden-duck-legacy"]
    });
  }

  if (/post\s+called\s+Sparkles[\s\S]{0,260}delete/i.test(stripTags(source))) {
    records.push({ ...KNOWN_TOMBSTONES[0] });
  }
  return records;
}

function recordIdentity(record) {
  if (record?.url) return canonicalBlogspotUrl(record.url);
  return `${record?.published || ""}|${key(record?.title || "")}`;
}

function sourcePriority(record) {
  const sources = Array.isArray(record?.sources) ? record.sources : [];
  if (sources.some((source) => source.startsWith("blogger"))) return 30;
  if (sources.includes("existing-archive")) return 20;
  if (sources.includes("golden-duck-legacy")) return 10;
  return 0;
}

function chooseText(current, incoming, preferIncoming = false) {
  const a = clean(current);
  const b = clean(incoming);
  if (!a) return b;
  if (!b) return a;
  return preferIncoming ? b : a;
}

export function mergeRecords(groups) {
  const map = new Map();
  for (const group of groups) {
    for (const raw of Array.isArray(group) ? group : []) {
      if (!raw?.title || !raw?.published) continue;
      const record = {
        ...raw,
        title: cleanTitle(raw.title),
        url: canonicalBlogspotUrl(raw.url),
        sources: Array.from(new Set(Array.isArray(raw.sources) ? raw.sources : []))
      };
      const identity = recordIdentity(record);
      if (!identity) continue;
      const existing = map.get(identity);
      if (!existing) {
        map.set(identity, record);
        continue;
      }

      const incomingPreferred = sourcePriority(record) >= sourcePriority(existing);
      const merged = {
        ...existing,
        id: chooseText(existing.id, record.id, incomingPreferred),
        title: chooseText(existing.title, record.title, incomingPreferred),
        originalTitle: chooseText(existing.originalTitle, record.originalTitle, incomingPreferred),
        published: chooseText(existing.published, record.published, incomingPreferred),
        year: record.year || existing.year,
        month: record.month || existing.month,
        day: record.day || existing.day,
        url: chooseText(existing.url, record.url, incomingPreferred),
        originalUrl: chooseText(existing.originalUrl, record.originalUrl, false),
        archiveUrl: chooseText(existing.archiveUrl, record.archiveUrl, false),
        image: chooseText(existing.image, record.image, incomingPreferred),
        originalImage: chooseText(existing.originalImage, record.originalImage, incomingPreferred),
        imageAlt: chooseText(existing.imageAlt, record.imageAlt, incomingPreferred),
        excerpt: chooseText(existing.excerpt, record.excerpt, incomingPreferred),
        status: existing.status === "original-unavailable" ? existing.status : (record.status || existing.status),
        note: chooseText(existing.note, record.note, false),
        authors: Array.from(new Set([...(existing.authors || []), ...(record.authors || [])])),
        labels: Array.from(new Set([...(existing.labels || []), ...(record.labels || [])])),
        updated: chooseText(existing.updated, record.updated, incomingPreferred),
        contentHtml: chooseText(existing.contentHtml, record.contentHtml, incomingPreferred),
        sources: Array.from(new Set([...(existing.sources || []), ...(record.sources || [])]))
      };
      map.set(identity, merged);
    }
  }

  return [...map.values()].sort((a, b) => {
    const dateComparison = String(b.published).localeCompare(String(a.published));
    return dateComparison || String(a.title).localeCompare(String(b.title));
  });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(POSTS_DIR, { recursive: true }),
    fs.mkdir(MEDIA_DIR, { recursive: true }),
    fs.mkdir(SNAPSHOTS_DIR, { recursive: true })
  ]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options = {}, config, label = "request") {
  const retries = Number(config.requestRetries ?? 2);
  const timeout = Number(config.requestTimeoutMs ?? 25000);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "user-agent": "Golden-Duck-AE-Archive/1.0 (+https://golden-duck.co.uk)",
          ...(options.headers || {})
        }
      });
      if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function fetchText(url, config, label) {
  const response = await fetchWithRetry(url, {}, config, label);
  return response.text();
}

async function fetchJson(url, config, label) {
  const response = await fetchWithRetry(url, {}, config, label);
  return response.json();
}

function feedEntries(payload) {
  const entries = payload?.feed?.entry;
  return Array.isArray(entries) ? entries : [];
}

function feedNumber(payload, fieldName) {
  const value = Number(payload?.feed?.[fieldName]?.$t || 0);
  return Number.isFinite(value) ? value : 0;
}

async function loadPaginatedFeed(config, { label = "", maximumPages, source }) {
  const collected = [];
  const seen = new Set();
  let startIndex = 1;
  let page = 0;
  let total = 0;
  const pageSize = Number(config.feedPageSize || 100);
  const pageLimit = Number(maximumPages || config.feedMaxPages || 20);

  while (page < pageLimit) {
    const labelPath = label ? `/-/${encodeURIComponent(label)}` : "";
    const url = `${config.bloggerBaseUrl}/feeds/posts/default${labelPath}?alt=json&max-results=${pageSize}&start-index=${startIndex}&orderby=published`;
    const payload = await fetchJson(url, config, `${source} page ${page + 1}`);
    const entries = feedEntries(payload);
    if (!total) total = feedNumber(payload, "openSearch$totalResults");
    let newCount = 0;
    for (const entry of entries) {
      const token = clean(entry?.id?.$t) || alternateLink(entry);
      if (token && seen.has(token)) continue;
      if (token) seen.add(token);
      const post = normaliseBloggerEntry(entry, source);
      if (post) {
        collected.push(post);
        newCount += 1;
      }
    }
    page += 1;
    const returned = entries.length;
    if (!returned || !newCount || (total && startIndex + returned - 1 >= total)) break;
    startIndex += returned;
  }

  return {
    posts: collected,
    pages: page,
    reportedTotal: total,
    complete: total ? collected.length >= total : true
  };
}

function authorMatches(post, names) {
  const wanted = new Set((names || []).map(key));
  return (post.authors || []).some((author) => wanted.has(key(author)));
}


async function enrichMissingPosts(posts, config, warnings) {
  const candidates = posts.filter((post) => post.url && !post.contentHtml && !post.archiveUrl);
  if (!candidates.length) return posts;
  const enriched = await mapWithConcurrency(candidates, 3, async (post) => {
    try {
      const url = `${config.bloggerBaseUrl}/feeds/posts/default?alt=json&max-results=12&orderby=published&q=${encodeURIComponent(post.originalTitle || post.title)}`;
      const payload = await fetchJson(url, config, `targeted lookup for ${post.title}`);
      const matches = feedEntries(payload).map((entry) => normaliseBloggerEntry(entry, "blogger-targeted-lookup")).filter(Boolean);
      return matches.find((item) => recordIdentity(item) === recordIdentity(post))
        || matches.find((item) => item.year === post.year && item.month === post.month && key(item.title) === key(post.title))
        || post;
    } catch (error) {
      warnings.push(`Could not enrich “${post.title}”: ${error.message}`);
      return post;
    }
  });
  const byIdentity = new Map(enriched.map((post) => [recordIdentity(post), post]));
  return posts.map((post) => {
    const richer = byIdentity.get(recordIdentity(post));
    return richer && richer.contentHtml
      ? { ...post, ...richer, sources: Array.from(new Set([...(post.sources || []), ...(richer.sources || [])])) }
      : post;
  });
}

function sanitizeArticleHtml(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(input|button)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "");
}

function extensionForContentType(contentType, url) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif"
  };
  if (map[type]) return map[type];
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpe?g|png|gif|webp|svg|avif)$/i);
    if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
  } catch {}
  return ".bin";
}

async function downloadImage(url, destinationWithoutExtension, config) {
  const response = await fetchWithRetry(url, {}, config, `image ${url}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Not an image: ${contentType || "unknown content type"}`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > Number(config.imageMaxBytes || 25000000)) {
    throw new Error(`Image exceeds configured limit: ${declaredLength} bytes`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > Number(config.imageMaxBytes || 25000000)) {
    throw new Error(`Image exceeds configured limit after download: ${buffer.length} bytes`);
  }
  const extension = extensionForContentType(contentType, url);
  const destination = `${destinationWithoutExtension}${extension}`;
  await fs.writeFile(destination, buffer);
  return destination;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExistingMedia(prefix) {
  const directory = path.dirname(prefix);
  const basename = path.basename(prefix);
  try {
    const entries = await fs.readdir(directory);
    const found = entries.find((entry) => entry.startsWith(`${basename}.`));
    return found ? path.join(directory, found) : "";
  } catch {
    return "";
  }
}

async function mirrorArticle(post, config, warnings) {
  if (!post.contentHtml || !post.url) return post;
  const parts = dateParts(post.published);
  if (!parts) return post;
  const slug = slugFromUrl(post.url, `post-${post.id || parts.iso}`);
  const articleDirectory = path.join(
    POSTS_DIR,
    String(parts.year),
    String(parts.month).padStart(2, "0"),
    slug
  );
  await fs.mkdir(articleDirectory, { recursive: true });

  const postKey = String(post.id || createHash("sha1").update(post.url).digest("hex").slice(0, 16))
    .replace(/[^a-z0-9_-]+/gi, "-");
  const mediaDirectory = path.join(MEDIA_DIR, postKey);
  await fs.mkdir(mediaDirectory, { recursive: true });

  let articleHtml = sanitizeArticleHtml(post.contentHtml);
  const imageTags = articleHtml.match(/<img\b[^>]*>/gi) || [];
  const replacements = new Map();
  let firstLocalImage = "";

  for (const tag of imageTags) {
    const sourceUrl = imageFromTag(tag);
    if (!sourceUrl) continue;
    if (!replacements.has(sourceUrl)) {
      const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 20);
      const prefix = path.join(mediaDirectory, hash);
      let localFile = await findExistingMedia(prefix);
      if (!localFile) {
        try {
          localFile = await downloadImage(sourceUrl, prefix, config);
        } catch (error) {
          warnings.push(`Could not mirror image for “${post.title}”: ${error.message}`);
          localFile = "";
        }
      }
      replacements.set(sourceUrl, localFile);
    }
    const localFile = replacements.get(sourceUrl);
    if (!localFile) continue;
    const relative = path.relative(articleDirectory, localFile).split(path.sep).join("/");
    if (!firstLocalImage) firstLocalImage = localFile;
    const alt = getAttribute(tag, "alt") || post.imageAlt || post.title;
    const replacementTag = `<img src="${escapeHtml(relative)}" alt="${escapeHtml(decodeHtml(alt))}" loading="lazy" decoding="async">`;
    articleHtml = articleHtml.replace(tag, replacementTag);
  }

  articleHtml = articleHtml.replace(/href\s*=\s*(["'])([^"']+)\1/gi, (full, quote, href) => {
    const canonical = /authorselectric\.blogspot\./i.test(href) ? canonicalBlogspotUrl(href) : href;
    return `href=${quote}${escapeHtml(canonical)}${quote}`;
  });

  const archiveRelativePath = path.relative(PUBLIC_DIR, path.join(articleDirectory, "index.html")).split(path.sep).join("/");
  const archiveUrl = `${String(config.pagesBaseUrl).replace(/\/$/, "")}/${archiveRelativePath.replace(/index\.html$/, "")}`;
  let localImageUrl = "";
  if (firstLocalImage) {
    const imageRelative = path.relative(PUBLIC_DIR, firstLocalImage).split(path.sep).join("/");
    localImageUrl = `${String(config.pagesBaseUrl).replace(/\/$/, "")}/${imageRelative}`;
  }

  const document = articleDocument({
    post,
    articleHtml,
    archiveUrl,
    goldenDuckArchiveUrl: config.goldenDuckArchiveUrl
  });
  await fs.writeFile(path.join(articleDirectory, "index.html"), document, "utf8");

  return {
    ...post,
    archiveUrl,
    image: localImageUrl || post.image,
    originalImage: post.originalImage || post.image,
    mirroredAt: new Date().toISOString()
  };
}

function articleDocument({ post, articleHtml, goldenDuckArchiveUrl }) {
  const published = dateParts(post.published);
  const dateLabel = published
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${published.iso}T12:00:00Z`))
    : post.published;
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <title>${escapeHtml(post.title)} — Julia Jones Authors Electric Archive</title>
  <style>
    :root{color-scheme:dark;--gold:#ffac00;--paper:#f3efe8;--copy:#d8d2c8;--bg:#101010;--panel:#171717;--rule:rgba(255,172,0,.25)}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--copy);font:17px/1.72 Georgia,"Times New Roman",serif}
    header,main,footer{width:min(900px,calc(100% - 36px));margin:auto}header{padding:48px 0 30px;border-bottom:1px solid var(--rule)}
    .eyebrow{margin:0 0 12px;color:var(--gold);font:800 12px/1 Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase}
    h1{margin:0;color:var(--paper);font-size:clamp(34px,6vw,62px);line-height:1.05;font-weight:400}.meta{margin:16px 0 0;color:#aaa;font:14px/1.5 Arial,sans-serif}
    nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:24px}a{color:var(--gold)}main{padding:42px 0 64px}.post-body{overflow-wrap:anywhere}.post-body img{max-width:100%;height:auto;margin:24px auto}.post-body table{display:block;max-width:100%;overflow:auto}
    blockquote{margin:28px 0;padding:4px 0 4px 22px;border-left:2px solid var(--gold)}footer{padding:26px 0 52px;border-top:1px solid var(--rule);color:#999;font:13px/1.6 Arial,sans-serif}
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">Preserved copy · Julia Jones at Authors Electric</p>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="meta">Originally published ${escapeHtml(dateLabel)}</p>
    <nav aria-label="Archive links">
      <a href="${escapeHtml(post.url)}">Open the original at Authors Electric</a>
      <a href="${escapeHtml(goldenDuckArchiveUrl)}">Return to the Golden Duck archive</a>
    </nav>
  </header>
  <main>
    <article class="post-body">${articleHtml}</article>
  </main>
  <footer>
    This preservation copy was generated automatically from the public Authors Electric feed. Copyright remains with Julia Jones and the respective owners of any included material.
  </footer>
</body>
</html>`;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return results;
}

function publicPost(record) {
  const { contentHtml, ...post } = record;
  return {
    ...post,
    url: canonicalBlogspotUrl(post.url),
    sources: Array.from(new Set(post.sources || []))
  };
}

function archiveChanged(previousPosts, nextPosts) {
  const comparable = (posts) => JSON.stringify((posts || []).map((post) => ({
    id: post.id,
    title: post.title,
    published: post.published,
    url: post.url,
    archiveUrl: post.archiveUrl,
    image: post.image,
    status: post.status,
    note: post.note
  })));
  return comparable(previousPosts) !== comparable(nextPosts);
}

function validateArchive(previousPosts, nextPosts, feedResult, minimumExpectedPosts = 0) {
  const errors = [];
  const warnings = [];
  if (!nextPosts.length) errors.push("The generated archive contains no posts.");
  const minimumExpected = Number(minimumExpectedPosts || 0);
  if (!previousPosts.length && minimumExpected && nextPosts.length < minimumExpected) {
    errors.push(`The first archive contains only ${nextPosts.length} posts; at least ${minimumExpected} were expected.`);
  }
  if (previousPosts.length && nextPosts.length < previousPosts.length) {
    errors.push(`The archive would shrink from ${previousPosts.length} to ${nextPosts.length} posts.`);
  }
  const identities = new Set();
  for (const post of nextPosts) {
    const identity = recordIdentity(post);
    if (identities.has(identity)) errors.push(`Duplicate post remains: ${post.title}`);
    identities.add(identity);
    if (!post.title || !post.published) errors.push("A post is missing a title or publication date.");
    if (post.url && post.url !== canonicalBlogspotUrl(post.url)) errors.push(`Non-canonical URL: ${post.url}`);
  }
  if (!feedResult.complete) warnings.push("The Blogger label feed did not report a completely retrieved result. Existing records were preserved.");
  if (nextPosts.some((post) => !post.image)) warnings.push("Some posts have no recoverable image. Their archive records were retained.");
  if (nextPosts.some((post) => post.status === "original-unavailable")) warnings.push("At least one historical post was already unavailable before this archive was created.");
  return { errors, warnings };
}

async function writeArchiveJavaScript(payload) {
  const serialised = JSON.stringify(payload);
  await fs.writeFile(
    ARCHIVE_JS_PATH,
    `window.GoldenDuckAuthorsElectricArchive = ${serialised};\nwindow.dispatchEvent(new CustomEvent("goldenduck:ae-archive-ready", { detail: window.GoldenDuckAuthorsElectricArchive }));\n`,
    "utf8"
  );
}

async function maybeWriteHeartbeat(config, force = false) {
  let shouldWrite = force;
  try {
    const stats = await fs.stat(HEARTBEAT_PATH);
    const ageDays = (Date.now() - stats.mtimeMs) / 86400000;
    if (ageDays >= Number(config.heartbeatDays || 30)) shouldWrite = true;
  } catch {
    shouldWrite = true;
  }
  if (shouldWrite) {
    await fs.writeFile(HEARTBEAT_PATH, `${new Date().toISOString()}\n`, "utf8");
  }
}

function statusPayload({ state, generatedAt, previousCount, nextCount, newCount, warnings, sources }) {
  return {
    schemaVersion: 1,
    state,
    checkedAt: generatedAt,
    previousPostCount: previousCount,
    postCount: nextCount,
    newPostCount: newCount,
    warnings,
    sources
  };
}

async function main() {
  await ensureDirectories();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  const existingPayload = await readJson(ARCHIVE_PATH, { posts: [] });
  const existingPosts = (existingPayload.posts || []).map((post) => ({ ...post, sources: [...(post.sources || []), "existing-archive"] }));
  const generatedAt = new Date().toISOString();
  const sourceReport = {};
  const runtimeWarnings = [];

  let legacyPosts = [];
  try {
    const legacyHtml = await fetchText(config.legacyArchiveUrl, config, "Golden Duck legacy archive");
    legacyPosts = parseLegacyArchive(legacyHtml);
    sourceReport.goldenDuckLegacy = { ok: true, count: legacyPosts.length };
  } catch (error) {
    sourceReport.goldenDuckLegacy = { ok: false, count: 0, error: error.message };
    runtimeWarnings.push(`Golden Duck legacy source was unavailable: ${error.message}`);
  }

  let labelResult = { posts: [], pages: 0, reportedTotal: 0, complete: false };
  try {
    labelResult = await loadPaginatedFeed(config, {
      label: config.bloggerLabel,
      maximumPages: config.feedMaxPages,
      source: "blogger-label"
    });
    sourceReport.bloggerLabel = {
      ok: true,
      count: labelResult.posts.length,
      pages: labelResult.pages,
      reportedTotal: labelResult.reportedTotal,
      complete: labelResult.complete
    };
  } catch (error) {
    sourceReport.bloggerLabel = { ok: false, count: 0, error: error.message };
    runtimeWarnings.push(`Blogger label feed was unavailable: ${error.message}`);
  }

  let recentPosts = [];
  try {
    const recentResult = await loadPaginatedFeed(config, {
      label: "",
      maximumPages: config.recentFeedPages,
      source: "blogger-recent-author-scan"
    });
    recentPosts = recentResult.posts.filter((post) => authorMatches(post, config.authorNames));
    sourceReport.recentAuthorScan = {
      ok: true,
      count: recentPosts.length,
      pages: recentResult.pages
    };
  } catch (error) {
    sourceReport.recentAuthorScan = { ok: false, count: 0, error: error.message };
    runtimeWarnings.push(`Recent author safety scan was unavailable: ${error.message}`);
  }

  if (!existingPosts.length && !legacyPosts.length && !labelResult.posts.length && !recentPosts.length) {
    await maybeWriteHeartbeat(config, true);
    const failure = statusPayload({
      state: "failed-no-source",
      generatedAt,
      previousCount: 0,
      nextCount: 0,
      newCount: 0,
      warnings: runtimeWarnings,
      sources: sourceReport
    });
    await fs.writeFile(STATUS_PATH, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
    throw new Error("No archive source could be loaded and no existing archive was available.");
  }

  let merged = mergeRecords([existingPosts, legacyPosts, labelResult.posts, recentPosts, KNOWN_TOMBSTONES]);
  const feedContentByIdentity = new Map(
    [...labelResult.posts, ...recentPosts]
      .filter((post) => post.contentHtml)
      .map((post) => [recordIdentity(post), post])
  );
  merged = merged.map((post) => {
    const rich = feedContentByIdentity.get(recordIdentity(post));
    return rich ? { ...post, ...rich, sources: Array.from(new Set([...(post.sources || []), ...(rich.sources || [])])) } : post;
  });

  merged = await enrichMissingPosts(merged, config, runtimeWarnings);

  const mirrored = await mapWithConcurrency(
    merged,
    Number(config.imageConcurrency || 4),
    (post) => mirrorArticle(post, config, runtimeWarnings)
  );
  const publicPosts = mirrored.map(publicPost);
  const validation = validateArchive(existingPosts, publicPosts, labelResult, config.minimumExpectedPosts);
  validation.warnings.push(...runtimeWarnings);

  if (validation.errors.length) {
    await maybeWriteHeartbeat(config, true);
    const failure = statusPayload({
      state: "failed-validation",
      generatedAt,
      previousCount: existingPosts.length,
      nextCount: publicPosts.length,
      newCount: Math.max(0, publicPosts.length - existingPosts.length),
      warnings: [...validation.errors, ...validation.warnings],
      sources: sourceReport
    });
    await fs.writeFile(STATUS_PATH, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
    throw new Error(`Archive validation failed: ${validation.errors.join(" | ")}`);
  }

  const changed = archiveChanged(existingPosts, publicPosts);
  const payload = {
    schemaVersion: 1,
    generatedAt,
    archiveState: "last-known-good",
    postCount: publicPosts.length,
    newestPostDate: publicPosts[0]?.published || "",
    goldenDuckArchiveUrl: config.goldenDuckArchiveUrl,
    sourceBlogUrl: config.bloggerBaseUrl,
    warnings: validation.warnings,
    sources: sourceReport,
    posts: publicPosts
  };

  if (changed || !existingPosts.length) {
    await fs.writeFile(ARCHIVE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeArchiveJavaScript(payload);
    const snapshotName = `archive-${generatedAt.replace(/[:.]/g, "-")}.json`;
    await fs.writeFile(path.join(SNAPSHOTS_DIR, snapshotName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  await fs.writeFile(
    STATUS_PATH,
    `${JSON.stringify(statusPayload({
      state: changed ? "updated" : "healthy-no-change",
      generatedAt,
      previousCount: existingPosts.length,
      nextCount: publicPosts.length,
      newCount: Math.max(0, publicPosts.length - existingPosts.length),
      warnings: validation.warnings,
      sources: sourceReport
    }), null, 2)}\n`,
    "utf8"
  );
  await maybeWriteHeartbeat(config, changed);
  console.log(`Archive healthy: ${publicPosts.length} posts (${changed ? "updated" : "no archive changes"}).`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
