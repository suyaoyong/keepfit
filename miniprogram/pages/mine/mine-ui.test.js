const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageDir = __dirname;

test("mine page maps auth status to user-facing text and exposes login CTA", () => {
  const js = fs.readFileSync(path.join(pageDir, "index.js"), "utf8");
  const wxml = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");

  assert.match(js, /buildAuthStatusText/);
  assert.match(js, /buildProfileDisplayName/);
  assert.match(js, /buildAuthActionText/);
  assert.match(js, /goLogin\(\)/);
  assert.doesNotMatch(wxml, /账号状态：\{\{profile\.status\}\}/);
  assert.match(wxml, /profile\.statusText/);
  assert.match(wxml, /profile\.actionText/);
  assert.match(wxml, /bindtap="goLogin"/);
});
