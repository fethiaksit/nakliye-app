import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the NakliyeGo admin entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NakliyeGo Yönetim Merkezi<\/title>/i);
  assert.match(html, /Yönetim merkezi hazırlanıyor/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps admin auth and API configuration separate", async () => {
  const [panel, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /NEXT_PUBLIC_ADMIN_API_URL/);
  assert.match(panel, /nakliye-admin-token/);
  assert.match(panel, /\/auth\/login/);
  assert.match(page, /<AdminPanel \/>/);
  assert.match(layout, /NakliyeGo Yönetim Merkezi/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("includes corporate accounts management with filters and review workflow", async () => {
  const panel = await readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Kurumsal Hesaplar/);
  assert.match(panel, /corporate-applications/);
  assert.match(panel, /Onay Bekleyenler/);
  assert.match(panel, /Onaylananlar/);
  assert.match(panel, /Reddedilenler/);
  assert.match(panel, /Firma adı/);
  assert.match(panel, /Yetkili kişi/);
  assert.match(panel, /Vergi numarası/);
  assert.match(panel, /Başvuru tarihi/);
  assert.match(panel, /ONAYLA/);
  assert.match(panel, /REDDET/);
  assert.match(panel, /rejectionReason/);
});

async function walletAccountsHTML(data) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { build } = require("esbuild");
  const result = await build({ entryPoints: [new URL("../app/DriverWalletAccounts.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  return renderToStaticMarkup(createElement(module.exports.default, { data, onOpenDriver() {}, onPage() {} }));
}

test("renders exact driver balances and disables pagination at the boundaries", async () => {
  const html = await walletAccountsHTML({ items: [{ driver: { id: "driver-1", name: "Test Şoför", phone: "05551234567" }, wallet: { balanceCents: 123456, reservedCents: 3456, availableCents: 120000 } }], total: 1, offset: 0, limit: 50, summary: { fundedCount: 1, reservedCount: 1 } });
  assert.match(html, /Test Şoför/);
  assert.match(html, /1\.234,56/);
  assert.match(html, /34,56/);
  assert.match(html, /1\.200,00/);
  assert.match(html, /Hesabı yönet/);
  assert.match(html, /disabled="">Önceki/);
  assert.match(html, /disabled="">Sonraki/);
});

test("renders an empty wallet filter without inventing accounts", async () => {
  const html = await walletAccountsHTML({ items: [], total: 0, offset: 0, limit: 50, summary: { fundedCount: 0, reservedCount: 0 } });
  assert.match(html, /Bu filtreye uygun şoför hesabı yok/);
  assert.doesNotMatch(html, /Hesabı yönet/);
});

test("rejects a previous tab payload instead of crashing wallet accounts", async () => {
  const html = await walletAccountsHTML({ counts: { drivers: 4 } });
  assert.match(html, /Hesaplar yüklenemedi/);
});
