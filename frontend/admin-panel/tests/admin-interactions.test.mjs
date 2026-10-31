import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

async function buildAndRender(entryPath, props = {}) {
  const result = await build({
    entryPoints: [new URL(entryPath, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime"],
    write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  const Component = module.exports.default || module.exports[Object.keys(module.exports)[0]];
  return renderToStaticMarkup(createElement(Component, props));
}

test("OperationCenter ActionQueue: renders unified queue with drivers, corporate apps and complaints", async () => {
  const { ActionQueue } = await (async () => {
    const result = await build({
      entryPoints: [new URL("../app/components/OperationCenter.tsx", import.meta.url).pathname],
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      write: false,
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  })();

  // 1. With items
  const items = [
    { id: "d-1", kind: "driver", title: "Ahmet Yılmaz", subtitle: "05551112233 · Şoför Belge Doğrulaması", badge: "Doğrulama Bekliyor", badgeColor: "badge-amber", avatarChar: "A" },
    { id: "c-1", kind: "corporate-application", title: "Lojistik A.Ş.", subtitle: "Mehmet Demir · Vergi No: 1234567890", badge: "Firma Onayı Bekliyor", badgeColor: "badge-blue", avatarChar: "🏢" },
    { id: "cmp-1", kind: "complaint", title: "Şikâyet: Ödeme anlaşmazlığı", subtitle: "Ali ➔ Veli (İnceleniyor)", badge: "İnceleniyor", badgeColor: "badge-amber", avatarChar: "⚠️" },
  ];

  const html = renderToStaticMarkup(createElement(ActionQueue, { items, onOpenItem() {} }));
  assert.match(html, /Ahmet Yılmaz/);
  assert.match(html, /Lojistik A\.Ş\./);
  assert.match(html, /Şikâyet: Ödeme anlaşmazlığı/);
  assert.match(html, /İnceleniyor/);
  assert.match(html, /Firma Onayı Bekliyor/);

  // 2. Empty items
  const emptyHtml = renderToStaticMarkup(createElement(ActionQueue, { items: [], onOpenItem() {} }));
  assert.match(emptyHtml, /Bekleyen acil işlem bulunmuyor/);

  // 3. Queue with error
  const errorHtml = renderToStaticMarkup(createElement(ActionQueue, { items: [], queueError: "Kurumsal başvurular API hatası", onRetry() {}, onOpenItem() {} }));
  assert.match(errorHtml, /Kurumsal başvurular API hatası/);
  assert.match(errorHtml, /Yeniden Dene/);
});

test("DriverDetailDrawer: renders profile header, tabs and verification actions", async () => {
  const { DriverDetailDrawer } = await (async () => {
    const result = await build({
      entryPoints: [new URL("../app/components/DriverDetailDrawer.tsx", import.meta.url).pathname],
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      write: false,
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  })();

  const driverData = {
    user: {
      id: "driver-123",
      name: "Kemal Şoför",
      phone: "05321112233",
      email: "kemal@example.com",
      verificationStatus: "pending",
      accountStatus: "active",
      createdAt: "2026-10-01T10:00:00Z",
      lastSeenAt: "2026-10-31T20:00:00Z",
      driverProfile: { serviceArea: "İstanbul", completedJobs: 15, rating: 4.8 },
    },
    documents: [
      { id: "doc-1", kind: "driver_license", title: "Ehliyet Ön", status: "verified", fileUrl: "/api/photos/doc-1.jpg" },
    ],
    vehicles: [
      { id: "veh-1", brand: "Ford", model: "Transit", licensePlate: "34AB1234", capacityKg: 3500, verificationStatus: "verified" },
    ],
  };

  const html = renderToStaticMarkup(createElement(DriverDetailDrawer, {
    data: driverData,
    note: "",
    setNote() {},
    busy: false,
    mutate: async () => {},
    request: async () => ({}),
    refresh() {},
  }));

  assert.match(html, /Kemal Şoför/);
  assert.match(html, /05321112233/);
  assert.match(html, /Genel Bilgiler/);
  assert.match(html, /Belgeler/);
  assert.match(html, /Araçlar/);
  assert.match(html, /Cüzdan &amp; Bakiye/);
  assert.match(html, /Şoförü Doğrula ve Onayla/);
  assert.match(html, /Doğrulamayı Reddet/);
});

test("CorporateDetailDrawer: renders corporate application and safely handles missing ownerCustomerId", async () => {
  const { CorporateDetailDrawer } = await (async () => {
    const result = await build({
      entryPoints: [new URL("../app/components/CorporateDetailDrawer.tsx", import.meta.url).pathname],
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      write: false,
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  })();

  const corpData = {
    id: "corp-app-1",
    companyName: "Atlas Nakliyat LTD",
    authorizedPerson: "Cemil Güler",
    phone: "02129998877",
    email: "info@atlasnakliyat.com",
    taxNumber: "9876543210",
    taxOffice: "Mecidiyeköy",
    address: "Büyükdere Cad. No: 100 Şişli / İstanbul",
    status: "approved",
    company: {
      id: "comp-1",
      name: "Atlas Nakliyat LTD",
      ownerCustomerId: "user-cust-456",
    },
    documents: [],
  };

  const html = renderToStaticMarkup(createElement(CorporateDetailDrawer, {
    data: corpData,
    note: "",
    setNote() {},
    busy: false,
    mutate: async () => {},
    request: async () => ({}),
  }));

  assert.match(html, /Atlas Nakliyat LTD/);
  assert.match(html, /Cemil Güler/);
  assert.match(html, /9876543210/);
  assert.match(html, /Mecidiyeköy/);
  assert.match(html, /Firma Bilgileri/);
  assert.match(html, /Başvuru Onay \/ Ret/);
});

test("LoadDetailDrawer: renders operational pipeline stepper matching backend state machine", async () => {
  const { LoadDetailDrawer } = await (async () => {
    const result = await build({
      entryPoints: [new URL("../app/components/LoadDetailDrawer.tsx", import.meta.url).pathname],
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      write: false,
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  })();

  // Corporate flow load
  const corporateLoad = {
    load: {
      id: "load-corp-99",
      title: "Fabrika Malzemeleri Nakliyesi",
      status: "payment_approval_pending",
      basePriceTl: 5000,
      agreedPriceTl: 5000,
      paymentApproval: {
        amountCents: 500000,
        customerPayableCents: 350000,
        creditCents: 150000,
        status: "pending",
      },
      driverCommissionCents: 50000,
      pickup: { city: "Kocaeli", district: "Gebze", address: "Gebze OSB" },
      delivery: { city: "Bursa", district: "Nilüfer", address: "Nilüfer Sanayi" },
    },
    customer: { name: "Otomotiv Parça A.Ş.", accountType: "corporate" },
    driver: { name: "Davut Kaptan" },
    statusHistory: [],
  };

  const html = renderToStaticMarkup(createElement(LoadDetailDrawer, {
    data: corporateLoad,
    note: "",
    setNote() {},
    busy: false,
    mutate: async () => {},
  }));

  assert.match(html, /Fabrika Malzemeleri Nakliyesi/);
  assert.match(html, /Kurumsal Akış/);
  assert.match(html, /Şoför Ödeme Onayı/);
  assert.match(html, /Teslimat Yolunda/);
  assert.match(html, /Kullanılan Kurumsal Kredi/);
  assert.match(html, /Müşteriden Alınacak Nakit Tutar/);
});
