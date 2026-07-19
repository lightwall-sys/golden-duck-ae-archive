import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalBlogspotUrl,
  mergeRecords,
  normaliseBloggerEntry,
  parseLegacyArchive
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
