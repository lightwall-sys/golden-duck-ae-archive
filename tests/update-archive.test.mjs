import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveChanged,
  articleRevisionHash,
  canonicalBlogspotUrl,
  mergeRecords,
  normaliseBloggerEntry,
  parseLegacyArchive,
  restorePreservedBody
} from "../scripts/update-archive.mjs";

test("canonicalBlogspotUrl removes www, country domains, HTTP, query and hash", () => {
  assert.equal(
    canonicalBlogspotUrl("http://www.authorselectric.blogspot.co.uk/2011/12/where-to-begin-by-julia-jones.html?m=1#more"),
    "https://authorselectric.blogspot.com/2011/12/where-to-begin-by-julia-jones.html"
  );
});

test("parseLegacyArchive reads dated historical links and canonicalises them", () => {
  const html = `
    <h2>2011</h2>
    <p><a href="http://www.authorselectric.blogspot.co.uk/2011/12/where-to-begin-by-julia-jones.html">December 2011 “Where To Begin? by Julia Jones”</a></p>
  `;
  const posts = parseLegacyArchive(html);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].published, "2011-12-09");
  assert.equal(posts[0].title, "Where To Begin?");
  assert.equal(posts[0].url, "https://authorselectric.blogspot.com/2011/12/where-to-begin-by-julia-jones.html");
});

test("normaliseBloggerEntry keeps content and extracts core metadata", () => {
  const entry = {
    id: { $t: "tag:blogger.com,1999:blog-1.post-123" },
    title: { $t: "Where To Begin? by Julia Jones" },
    published: { $t: "2011-12-09T08:00:00.000Z" },
    updated: { $t: "2011-12-09T09:00:00.000Z" },
    link: [{ rel: "alternate", href: "http://www.authorselectric.blogspot.co.uk/2011/12/where-to-begin-by-julia-jones.html" }],
    author: [{ name: { $t: "julia jones" } }],
    category: [{ term: "Julia Jones" }],
    content: { $t: '<p>Hello archive.</p><img src="https://example.com/photo.jpg" alt="Photo">' }
  };
  const post = normaliseBloggerEntry(entry);
  assert.equal(post.id, "123");
  assert.equal(post.title, "Where To Begin?");
  assert.equal(post.published, "2011-12-09");
  assert.equal(post.url, "https://authorselectric.blogspot.com/2011/12/where-to-begin-by-julia-jones.html");
  assert.equal(post.image, "https://example.com/photo.jpg");
  assert.match(post.contentHtml, /Hello archive/);
});

test("mergeRecords is append-preserving and prefers richer Blogger data", () => {
  const existing = [{
    id: "old",
    title: "Where To Begin?",
    published: "2011-12-09",
    year: 2011,
    month: 12,
    day: 9,
    url: "https://authorselectric.blogspot.com/2011/12/where-to-begin-by-julia-jones.html",
    archiveUrl: "https://example.com/archive",
    image: "",
    sources: ["existing-archive"]
  }];
  const feed = [{
    id: "123",
    title: "Where To Begin?",
    published: "2011-12-09",
    year: 2011,
    month: 12,
    day: 9,
    url: "https://authorselectric.blogspot.com/2011/12/where-to-begin-by-julia-jones.html",
    image: "https://example.com/photo.jpg",
    excerpt: "A richer record",
    sources: ["blogger-label"]
  }];
  const merged = mergeRecords([existing, feed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].archiveUrl, "https://example.com/archive");
  assert.equal(merged[0].image, "https://example.com/photo.jpg");
  assert.equal(merged[0].id, "123");
});

test("mergeRecords replaces an existing article revision when Blogger returns the same canonical URL", () => {
  const url = "https://authorselectric.blogspot.com/2026/09/welcome-to-big-tree-lodge.html";
  const existing = [{
    id: "6091472654001519608",
    title: "Welcome to Big Tree Lodge",
    published: "2026-09-09",
    url,
    image: "https://example.com/old-lead.jpg",
    excerpt: "Old excerpt",
    updated: "2026-09-09",
    contentHtml: '<p>Old wording.</p><img src="https://example.com/old-lead.jpg">',
    sources: ["existing-archive"]
  }];
  const blogger = [{
    id: "6091472654001519608",
    title: "Welcome to Big Tree Lodge",
    published: "2026-09-09",
    url,
    image: "https://example.com/new-lead.jpg",
    excerpt: "Revised excerpt",
    updated: "2026-09-10",
    contentHtml: '<p>Julia revised this wording.</p><img src="https://example.com/new-lead.jpg"><img src="https://example.com/added.jpg">',
    sources: ["blogger-label"]
  }];
  const merged = mergeRecords([existing, blogger]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].image, "https://example.com/new-lead.jpg");
  assert.equal(merged[0].excerpt, "Revised excerpt");
  assert.equal(merged[0].updated, "2026-09-10");
  assert.match(merged[0].contentHtml, /Julia revised this wording/);
  assert.match(merged[0].contentHtml, /added\.jpg/);
});

test("articleRevisionHash changes for prose edits, added images and image reordering", () => {
  const base = {
    title: "Welcome to Big Tree Lodge",
    published: "2026-09-09",
    contentHtml: '<p>Original wording.</p><img src="https://example.com/a.jpg"><img src="https://example.com/b.jpg">'
  };
  const proseEdit = { ...base, contentHtml: base.contentHtml.replace("Original wording.", "Revised wording.") };
  const addedImage = { ...base, contentHtml: `${base.contentHtml}<img src="https://example.com/c.jpg">` };
  const imageReorder = { ...base, contentHtml: '<p>Original wording.</p><img src="https://example.com/b.jpg"><img src="https://example.com/a.jpg">' };
  assert.notEqual(articleRevisionHash(base), articleRevisionHash(proseEdit));
  assert.notEqual(articleRevisionHash(base), articleRevisionHash(addedImage));
  assert.notEqual(articleRevisionHash(base), articleRevisionHash(imageReorder));
});

test("archiveChanged treats a prose-only revision as a real archive change", () => {
  const stable = {
    id: "6091472654001519608",
    title: "Welcome to Big Tree Lodge",
    published: "2026-09-09",
    url: "https://authorselectric.blogspot.com/2026/09/welcome-to-big-tree-lodge.html",
    image: "https://example.com/lead.jpg",
    preservationStatus: "full",
    revisionHash: "old-revision"
  };
  assert.equal(archiveChanged([stable], [{ ...stable, revisionHash: "new-revision" }]), true);
  assert.equal(archiveChanged([stable], [{ ...stable }]), false);
});

test("restorePreservedBody keeps a last-known-good body when live recovery is unavailable", () => {
  const url = "https://authorselectric.blogspot.com/2020/01/example.html";
  const restored = restorePreservedBody(
    { id: "123", title: "Example", published: "2020-01-09", url, sources: ["existing-archive"] },
    { id: "123", title: "Example", published: "2020-01-09", url, contentHtml: "<p>Previously verified preserved content.</p>" }
  );
  assert.match(restored.contentHtml, /Previously verified preserved content/);
  assert.equal(restored.sources.includes("preserved-raw-fallback"), true);
  assert.ok(restored.revisionHash);
});

test("restorePreservedBody refuses a raw copy belonging to a different canonical URL", () => {
  const restored = restorePreservedBody(
    { id: "123", title: "Example", published: "2020-01-09", url: "https://authorselectric.blogspot.com/2020/01/example.html" },
    { id: "123", url: "https://authorselectric.blogspot.com/2020/01/different.html", contentHtml: "<p>Wrong article.</p>" }
  );
  assert.equal(restored.contentHtml, undefined);
});

import {
  classifyDuplicatePosts,
  cleanReadableArticleHtml,
  extractPostBodyFromPage
} from "../scripts/update-archive.mjs";

test("extractPostBodyFromPage recovers a legacy Blogger post body", () => {
  const html = `<!doctype html><html><body><div class="sidebar">Ignore me</div><div class='post-body entry-content float-container' id='post-body-123'><p>First paragraph of the article.</p><div><p>Second paragraph with enough text to identify the actual post body reliably.</p></div></div></body></html>`;
  const body = extractPostBodyFromPage(html);
  assert.match(body, /First paragraph/);
  assert.match(body, /Second paragraph/);
  assert.doesNotMatch(body, /Ignore me/);
});

test("classifyDuplicatePosts preserves both records but hides the non-canonical duplicate", () => {
  const content = `<p>${"The same preserved article wording appears here. ".repeat(20)}</p>`;
  const records = classifyDuplicatePosts([
    {
      id: "canonical", title: "Barnacle Goose, her story", published: "2026-07-09", year: 2026, month: 7, day: 9,
      url: "https://authorselectric.blogspot.com/2026/07/barnacle-goose-her-story.html", contentHtml: content,
      sources: ["golden-duck-legacy", "blogger-label"]
    },
    {
      id: "duplicate", title: "BARNACLE GOOSE How an English yacht became a Scottish workboat", published: "2026-07-10", year: 2026, month: 7, day: 10,
      url: "https://authorselectric.blogspot.com/2026/07/barnacle-goose-how-english-yacht.html", contentHtml: content,
      sources: ["blogger-label"]
    }
  ]);
  assert.equal(records.length, 2);
  assert.equal(records.find((post) => post.id === "canonical").display, true);
  const duplicate = records.find((post) => post.id === "duplicate");
  assert.equal(duplicate.display, false);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.duplicateOf, "canonical");
});


test("cleanReadableArticleHtml removes Blogger colours and inline presentation while keeping structure", () => {
  const cleaned = cleanReadableArticleHtml('<p style="background-color:white;color:black" class="separator"><font color="white"><strong>Readable text</strong></font></p>');
  assert.doesNotMatch(cleaned, /style=|class=|<\/?font/i);
  assert.match(cleaned, /<strong>Readable text<\/strong>/);
});

import { offlineHostedPath } from "../scripts/build-download-bundle.mjs";

test("offlineHostedPath converts hosted preserved pages and images into bundle-relative paths", () => {
  const base = "https://lightwall-sys.github.io/golden-duck-ae-archive";
  assert.equal(
    offlineHostedPath(`${base}/posts/2011/12/where-to-begin/`, base, "page"),
    "posts/2011/12/where-to-begin/index.html"
  );
  assert.equal(
    offlineHostedPath(`${base}/media/123/photo.jpg`, base, "file"),
    "media/123/photo.jpg"
  );
});

import {
  localisePreservedPageHtml,
  relativeArchiveIndexHref
} from "../scripts/build-download-bundle.mjs";

test("relativeArchiveIndexHref points a deeply nested preserved page back to the offline index", () => {
  const bundle = "/tmp/archive/Julia-Jones-Authors-Electric-Archive";
  const article = `${bundle}/posts/2011/12/where-to-begin/index.html`;
  assert.equal(relativeArchiveIndexHref(article, bundle), "../../../../OPEN THE ARCHIVE.html");
});

test("localisePreservedPageHtml rewrites archive navigation and logo to local bundle paths", () => {
  const bundle = "/tmp/archive/Julia-Jones-Authors-Electric-Archive";
  const article = `${bundle}/posts/2011/12/where-to-begin/index.html`;
  const html = '<a data-archive-index-link href="https://golden-duck.co.uk/julia-ae-archive">Return</a><img data-brand-logo src="https://example.com/logo.png" alt="Golden Duck">';
  const localised = localisePreservedPageHtml(html, { articleFilePath: article, bundleDirectory: bundle });
  assert.match(localised, /href="\.\.\/\.\.\/\.\.\/\.\.\/OPEN THE ARCHIVE\.html"/);
  assert.match(localised, /src="\.\.\/\.\.\/\.\.\/\.\.\/assets\/golden-duck-logo\.png"/);
  assert.doesNotMatch(localised, /golden-duck\.co\.uk\/julia-ae-archive/);
});
