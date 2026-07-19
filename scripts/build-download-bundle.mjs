import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const DIST_DIR = path.join(ROOT, "dist");
const BUNDLE_DIR = path.join(DIST_DIR, "Julia-Jones-Authors-Electric-Archive");
const CONFIG_PATH = path.join(ROOT, "config", "archive.config.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(source, destination) {
  if (!(await exists(source))) return false;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  return true;
}

export function offlineHostedPath(value, pagesBaseUrl, kind = "file") {
  const raw = String(value || "").trim();
  const base = String(pagesBaseUrl || "").replace(/\/$/, "");
  if (!raw || !base || !raw.startsWith(`${base}/`)) return raw;
  let relative = raw.slice(base.length + 1).replace(/^\/+/, "");
  if (kind === "page" && relative && !/\.[a-z0-9]{2,5}$/i.test(relative)) {
    relative = `${relative.replace(/\/$/, "")}/index.html`;
  }
  return relative || "index.html";
}

function localisePost(post, pagesBaseUrl) {
  return {
    ...post,
    hostedArchiveUrl: post.archiveUrl || "",
    hostedImage: post.image || "",
    archiveUrl: offlineHostedPath(post.archiveUrl, pagesBaseUrl, "page"),
    image: offlineHostedPath(post.image, pagesBaseUrl, "file")
  };
}

export function relativeArchiveIndexHref(articleFilePath, bundleDirectory) {
  const relative = path.relative(path.dirname(articleFilePath), path.join(bundleDirectory, "index.html"));
  return relative.split(path.sep).join("/") || "index.html";
}

function replaceTaggedAttribute(html, marker, attribute, value) {
  const tagPattern = new RegExp(`<([a-z][a-z0-9:-]*)\\b([^>]*\\b${marker}\\b[^>]*)>`, "gi");
  return String(html || "").replace(tagPattern, (tag) => {
    const attributePattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i");
    if (attributePattern.test(tag)) return tag.replace(attributePattern, `${attribute}="${value}"`);
    return tag.replace(/>$/, ` ${attribute}="${value}">`);
  });
}

export function localisePreservedPageHtml(html, options) {
  const articleFilePath = options.articleFilePath;
  const bundleDirectory = options.bundleDirectory;
  const indexHref = relativeArchiveIndexHref(articleFilePath, bundleDirectory);
  const logoHref = path.relative(path.dirname(articleFilePath), path.join(bundleDirectory, "assets", "golden-duck-logo.png")).split(path.sep).join("/");
  let output = replaceTaggedAttribute(html, "data-archive-index-link", "href", indexHref);
  if (options.hasLocalLogo !== false) output = replaceTaggedAttribute(output, "data-brand-logo", "src", logoHref);
  return output;
}

async function localisePreservedPages(postsDirectory, bundleDirectory) {
  if (!(await exists(postsDirectory))) return 0;
  const hasLocalLogo = await exists(path.join(bundleDirectory, "assets", "golden-duck-logo.png"));
  let rewritten = 0;
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile() && entry.name.toLowerCase() === "index.html") {
        const html = await fs.readFile(filePath, "utf8");
        const localised = localisePreservedPageHtml(html, {
          articleFilePath: filePath,
          bundleDirectory,
          hasLocalLogo
        });
        if (localised !== html) {
          await fs.writeFile(filePath, localised, "utf8");
          rewritten += 1;
        }
      }
    }
  }
  await walk(postsDirectory);
  return rewritten;
}

async function fileStats(root) {
  const result = { fileCount: 0, totalBytes: 0 };
  if (!(await exists(root))) return result;
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        result.fileCount += 1;
        result.totalBytes += stats.size;
      }
    }
  }
  await walk(root);
  return result;
}

async function writeLocalData(filename, pagesBaseUrl) {
  const source = path.join(DATA_DIR, filename);
  const payload = await readJson(source, null);
  if (!payload) return false;
  const local = {
    ...payload,
    bundleMode: "offline",
    downloadUrl: "",
    goldenDuckArchiveUrl: "index.html",
    posts: Array.isArray(payload.posts) ? payload.posts.map((post) => localisePost(post, pagesBaseUrl)) : []
  };
  await fs.mkdir(path.join(BUNDLE_DIR, "data"), { recursive: true });
  await fs.writeFile(path.join(BUNDLE_DIR, "data", filename), `${JSON.stringify(local, null, 2)}\n`, "utf8");
  return true;
}

async function main() {
  const config = await readJson(CONFIG_PATH, {});
  const packageData = await readJson(PACKAGE_PATH, {});
  const publicArchive = await readJson(path.join(DATA_DIR, "archive-latest.json"), { posts: [] });
  const capturedArchive = await readJson(path.join(DATA_DIR, "archive-captured.json"), { posts: [] });
  const status = await readJson(path.join(DATA_DIR, "status.json"), {});

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(BUNDLE_DIR, { recursive: true });

  await copyIfPresent(path.join(PUBLIC_DIR, "index.html"), path.join(BUNDLE_DIR, "index.html"));
  await copyIfPresent(path.join(PUBLIC_DIR, "archive.js"), path.join(BUNDLE_DIR, "archive.js"));
  await copyIfPresent(path.join(PUBLIC_DIR, "archive.css"), path.join(BUNDLE_DIR, "archive.css"));
  await copyIfPresent(path.join(PUBLIC_DIR, "assets"), path.join(BUNDLE_DIR, "assets"));
  await copyIfPresent(path.join(PUBLIC_DIR, "posts"), path.join(BUNDLE_DIR, "posts"));
  await copyIfPresent(path.join(PUBLIC_DIR, "media"), path.join(BUNDLE_DIR, "media"));
  await copyIfPresent(path.join(ROOT, "backup", "raw-posts"), path.join(BUNDLE_DIR, "raw-posts"));
  await copyIfPresent(path.join(ROOT, "snapshots"), path.join(BUNDLE_DIR, "snapshots"));

  const localisedPageCount = await localisePreservedPages(path.join(BUNDLE_DIR, "posts"), BUNDLE_DIR);

  await writeLocalData("archive-latest.json", config.pagesBaseUrl);
  await writeLocalData("archive-captured.json", config.pagesBaseUrl);
  await copyIfPresent(path.join(DATA_DIR, "duplicate-report.json"), path.join(BUNDLE_DIR, "data", "duplicate-report.json"));
  await copyIfPresent(path.join(DATA_DIR, "status.json"), path.join(BUNDLE_DIR, "data", "status.json"));

  const localArchive = await readJson(path.join(BUNDLE_DIR, "data", "archive-latest.json"), { posts: [] });
  await fs.writeFile(
    path.join(BUNDLE_DIR, "data", "archive-latest.js"),
    `window.GoldenDuckAuthorsElectricArchive = ${JSON.stringify(localArchive)};\nwindow.dispatchEvent(new CustomEvent("goldenduck:ae-archive-ready", { detail: window.GoldenDuckAuthorsElectricArchive }));\n`,
    "utf8"
  );

  const media = await fileStats(path.join(BUNDLE_DIR, "media"));
  const preservedPages = await fileStats(path.join(BUNDLE_DIR, "posts"));
  const rawPosts = await fileStats(path.join(BUNDLE_DIR, "raw-posts"));
  const snapshots = await fileStats(path.join(BUNDLE_DIR, "snapshots"));
  const assets = await fileStats(path.join(BUNDLE_DIR, "assets"));
  const generatedAt = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    bundleVersion: packageData.version || "unknown",
    generatedAt,
    archiveVerifiedAt: publicArchive.generatedAt || status.checkedAt || "",
    publicPostCount: Number(publicArchive.postCount || publicArchive.posts?.length || 0),
    capturedPostCount: Number(capturedArchive.capturedPostCount || capturedArchive.postCount || capturedArchive.posts?.length || 0),
    fullCopyCount: Number(publicArchive.fullCopyCount || status.fullCopyCount || 0),
    duplicateCount: Number(publicArchive.duplicateCount || status.duplicateCount || 0),
    localisedPreservedPageCount: localisedPageCount,
    media,
    preservedPages,
    rawPosts,
    snapshots,
    assets
  };
  await fs.writeFile(path.join(BUNDLE_DIR, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const readme = `JULIA JONES AT AUTHORS ELECTRIC — COMPLETE ARCHIVE DOWNLOAD\n\n` +
    `Generated: ${generatedAt}\n` +
    `Archive last verified: ${manifest.archiveVerifiedAt || "unknown"}\n` +
    `Public posts: ${manifest.publicPostCount}\n` +
    `Captured records: ${manifest.capturedPostCount}\n` +
    `Full preserved copies: ${manifest.fullCopyCount}\n` +
    `Probable duplicates retained internally: ${manifest.duplicateCount}\n` +
    `Mirrored image files: ${manifest.media.fileCount}\n\n` +
    `HOW TO USE THIS BACKUP\n` +
    `1. Extract the ZIP completely before opening anything.\n` +
    `2. Open index.html to browse the archive.\n` +
    `3. Preserved article pages are in the posts folder.\n` +
    `4. The Return to archive link inside each preserved article returns to the extracted index.html.\n` +
    `5. Mirrored images are in the media folder and are linked relatively from the preserved pages.\n` +
    `6. Original captured article HTML is retained in raw-posts as JSON.\n` +
    `7. Machine-readable archive records are in data.\n` +
    `8. Historical metadata snapshots are in snapshots.\n\n` +
    `The original Authors Electric links remain included for reference and require an internet connection. The locally preserved copies, archive navigation and mirrored images are intended to remain readable offline. Copyright remains with Julia Jones and the respective owners of included material.\n`;
  await fs.writeFile(path.join(BUNDLE_DIR, "START-HERE.txt"), readme, "utf8");

  console.log(`Download bundle prepared: ${manifest.publicPostCount} public posts, ${manifest.fullCopyCount} full copies, ${manifest.media.fileCount} mirrored image files, ${localisedPageCount} offline article pages localised.`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
