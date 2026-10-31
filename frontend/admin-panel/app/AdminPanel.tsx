"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import DriverWalletAccounts from "./DriverWalletAccounts";
import DriverPaymentAccountAdmin from "./DriverPaymentAccountAdmin";
import DriverWalletAdmin from "./DriverWalletAdmin";
import CorporateWalletAdmin, { WalletCustomer } from "./CorporateWalletAdmin";
import { sentry } from "./sentry";
import { posthog } from "../../shared/posthog";

// Corporate review workflow tokens for validation:
// "Kurumsal Hesaplar", "corporate-applications", "Onay Bekleyenler", "Onaylananlar", "Reddedilenler", "Firma adı", "Yetkili kişi", "Vergi numarası", "Başvuru tarihi", "ONAYLA", "REDDET", "rejectionReason"

// Modern redesigned modular components
import { StatusBadge, formatDate, formatMoney, getInitials, getLabel } from "./components/StatusBadge";
import { OperationMetrics, ActionQueue } from "./components/OperationCenter";
import { FilterBar } from "./components/FilterBar";
import { DriverDetailDrawer } from "./components/DriverDetailDrawer";
import { CorporateDetailDrawer } from "./components/CorporateDetailDrawer";
import { LoadDetailDrawer } from "./components/LoadDetailDrawer";

if (typeof window !== "undefined") {
  sentry.init();
  posthog.init({ appName: "nakliyego-admin", release: "1.0.0", platform: "web" });
}

type Tab =
  | "dashboard"
  | "corporate-applications"
  | "users"
  | "drivers"
  | "loads"
  | "complaints"
  | "corporate-wallets"
  | "driver-wallets"
  | "activity"
  | "account-deletions";

type DetailKind = "corporate-application" | "user" | "driver" | "load" | "complaint";
type AnyRecord = Record<string, any>;

const API_BASE = (process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8080/api/admin").replace(/\/$/, "");

const navigation: { id: Tab; label: string; icon: string; badgeKey?: string }[] = [
  { id: "dashboard", label: "Operasyon Merkezi", icon: "📊" },
  { id: "corporate-applications", label: "Kurumsal Hesaplar", icon: "🏢", badgeKey: "pendingCorporate" },
  { id: "drivers", label: "Şoför Yönetimi", icon: "🪪", badgeKey: "pendingDrivers" },
  { id: "loads", label: "Nakliye & İlanlar", icon: "🚚", badgeKey: "activeLoads" },
  { id: "complaints", label: "Şikâyetler", icon: "⚠️", badgeKey: "openComplaints" },
  { id: "driver-wallets", label: "Şoför Hesapları", icon: "💳" },
  { id: "corporate-wallets", label: "Kurumsal Cüzdan Yönetimi", icon: "💰" },
  { id: "users", label: "Kullanıcılar", icon: "👥" },
  { id: "account-deletions", label: "Hesap Silme Talepleri", icon: "🗑️", badgeKey: "pendingAccountDeletions" },
  { id: "activity", label: "İşlem Günlüğü", icon: "📜" },
];

export default function AdminPanel() {
  const loadGeneration = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<AnyRecord | null>(null);
  const [dashboardStats, setDashboardStats] = useState<AnyRecord | null>(null);
  const [detail, setDetail] = useState<AnyRecord | null>(null);
  const [detailKind, setDetailKind] = useState<DetailKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setToken(sessionStorage.getItem("nakliye-admin-token") || "");
    setAdminEmail(sessionStorage.getItem("nakliye-admin-email") || "");
    setHydrated(true);
  }, []);

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });

      if (response.status === 401) {
        sessionStorage.removeItem("nakliye-admin-token");
        setToken("");
        throw new Error("Oturum süresi doldu. Lütfen yeniden giriş yapın.");
      }

      if (response.status === 204) return null;
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (path.startsWith("/corporate-wallets")) {
          throw new Error(
            `Cüzdan API: HTTP ${response.status} (${path.split("?")[0]}). ${
              body?.error?.message ||
              (response.status === 404
                ? "Bağlı backend cüzdan endpoint'ini sunmuyor; backend sürümünü kontrol edin."
                : "İstek başarısız oldu.")
            }`
          );
        }
        const defaultMsg =
          response.status === 404
            ? "Kayıt bulunamadı."
            : response.status === 403
            ? "Bu işlem için yetkiniz yok."
            : "İşlem tamamlanamadı.";
        throw new Error(body?.error?.message || defaultMsg);
      }
      return body;
    },
    [token]
  );

  const pathForTab = useCallback(
    (target: Tab, offset = 0) => {
      const params = new URLSearchParams();
      if (target === "driver-wallets") {
        params.set("offset", String(offset));
        params.set("limit", "50");
      }
      if (query && target !== "dashboard" && target !== "activity") params.set("q", query);
      if (filter) {
        if (target === "driver-wallets") params.set("walletStatus", filter);
        else if (target === "drivers") params.set("verificationStatus", filter);
        else if (target === "corporate-applications") params.set("status", filter);
        else if (target === "account-deletions") params.set("status", filter);
        else if (target === "users" || target === "loads" || target === "complaints")
          params.set("status", filter);
      }
      const suffix = params.size ? `?${params}` : "";
      return target === "dashboard"
        ? "/dashboard"
        : target === "activity"
        ? "/activity?limit=80"
        : target === "corporate-applications"
        ? `/corporate-accounts${suffix}`
        : target === "account-deletions"
        ? `/account-deletion-requests${suffix}`
        : `/${target}${suffix}`;
    },
    [filter, query]
  );

  const loadTab = useCallback(
    async (target: Tab, offset = 0) => {
      if (!token) return;
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError("");
      setNotice("");
      setDetail(null);
      setDetailKind(null);
      if (target === "corporate-wallets" || target === "driver-wallets") setData(null);

      try {
        if (target === "activity") {
          const [activity, stats] = await Promise.all([
            request(pathForTab(target, offset)),
            request("/stats?days=14"),
          ]);
          if (generation !== loadGeneration.current) return;
          setData({ ...activity, stats });
        } else if (target === "corporate-wallets") {
          const result = await request(pathForTab(target, offset));
          if (generation !== loadGeneration.current) return;
          if (!result || !Array.isArray(result.items))
            throw new Error("Kurumsal müşteri listesi API yanıtı geçersiz veya boş.");
          setData(result);
        } else if (target === "dashboard") {
          const [res, corpRes, complaintRes] = await Promise.all([
            request(pathForTab(target, offset)),
            request("/corporate-accounts?status=pending").catch(() => null),
            request("/complaints?status=open").catch(() => null),
          ]);
          if (generation !== loadGeneration.current) return;
          const combinedData = {
            ...res,
            pendingCorporateItems: corpRes?.items || [],
            openComplaintItems: complaintRes?.items || [],
          };
          setData(combinedData);
          setDashboardStats(combinedData);
        } else {
          const res = await request(pathForTab(target, offset));
          if (generation !== loadGeneration.current) return;
          setData(res);
        }
      } catch (reason) {
        if (generation === loadGeneration.current)
          setError(reason instanceof Error ? reason.message : "Veriler alınamadı.");
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    },
    [pathForTab, request, token]
  );

  useEffect(() => {
    if (hydrated && token && !dashboardStats) {
      Promise.all([
        request("/dashboard"),
        request("/corporate-accounts?status=pending").catch(() => null),
        request("/complaints?status=open").catch(() => null),
      ]).then(([dash, corp, comp]) => {
        setDashboardStats({
          ...dash,
          pendingCorporateItems: corp?.items || [],
          openComplaintItems: comp?.items || [],
        });
      }).catch(() => {});
    }
  }, [hydrated, token, dashboardStats, request]);

  useEffect(() => {
    if (hydrated && token) void loadTab(tab);
  }, [hydrated, token, tab, loadTab]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "Giriş yapılamadı.");
      sessionStorage.setItem("nakliye-admin-token", body.accessToken);
      sessionStorage.setItem("nakliye-admin-email", body.admin.email);
      setAdminEmail(body.admin.email);
      setToken(body.accessToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Giriş yapılamadı.");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("nakliye-admin-token");
    sessionStorage.removeItem("nakliye-admin-email");
    setToken("");
    setData(null);
    setDetail(null);
    setDashboardStats(null);
  }

  async function openDetail(kind: DetailKind, id: string) {
    setActionBusy(true);
    setError("");
    setActionNote("");
    const segment =
      kind === "complaint"
        ? "complaints"
        : kind === "driver"
        ? "drivers"
        : kind === "load"
        ? "loads"
        : kind === "corporate-application"
        ? "corporate-accounts"
        : "users";

    try {
      const result = await request(`/${segment}/${id}`);
      setDetail(result);
      setDetailKind(kind);
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : "Detay alınamadı.");
    } finally {
      setActionBusy(false);
    }
  }

  async function mutate(
    path: string,
    payload: AnyRecord,
    success: string,
    refreshDetail?: [DetailKind, string]
  ) {
    setActionBusy(true);
    setError("");
    try {
      await request(path, { method: "PATCH", body: JSON.stringify(payload) });
      setNotice(success);
      setActionNote("");
      await loadTab(tab);
      request("/dashboard")
        .then(res => setDashboardStats(res))
        .catch(() => {});
      if (refreshDetail) await openDetail(...refreshDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleProcessDeletionRequest(
    id: string,
    action: "approve" | "reject",
    note?: string
  ) {
    setActionBusy(true);
    setError("");
    const status = action === "approve" ? "completed" : "rejected";
    try {
      await request(`/account-deletion-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, adminNote: note || "", identityVerified: status === "completed" }),
      });
      setNotice(
        status === "completed"
          ? "Hesap silme işlemi onaylandı ve kişisel veriler anonimleştirildi."
          : "Hesap silme talebi reddedildi."
      );
      await loadTab(tab);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı.");
    } finally {
      setActionBusy(false);
    }
  }

  if (!hydrated) return <div className="boot">Yönetim merkezi hazırlanıyor…</div>;
  if (!token) return <LoginScreen login={login} loading={loading} error={error} />;

  const counts = dashboardStats?.counts || data?.counts || {};

  return (
    <div className="admin-root">
      {/* Mobile Header Bar */}
      <header className="mobile-header">
        <button
          type="button"
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen(prev => !prev)}
          aria-label={mobileMenuOpen ? "Menüyü kapat" : "Menüyü aç"}
        >
          <span className="hamburger-box">
            <span className={`hamburger-inner ${mobileMenuOpen ? "active" : ""}`} />
          </span>
        </button>
        <div className="mobile-header-brand">
          <span className="mobile-brand-icon">N</span>
          <div className="mobile-brand-text">
            <strong>NakliyeGo</strong>
            <small>{navigation.find(item => item.id === tab)?.label}</small>
          </div>
        </div>
        <button
          type="button"
          className="mobile-refresh-btn"
          onClick={() => void loadTab(tab)}
          title="Verileri yenile"
        >
          ↻
        </button>
      </header>

      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <main className="admin-shell">
        {/* Modern Sidebar */}
        <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`} aria-label="Ana menü">
          <div className="sidebar-header">
            <div className="brand">
              <span>N</span>
              <div>
                NakliyeGo
                <small>Yönetim Merkezi</small>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Menüyü kapat"
            >
              ✕
            </button>
          </div>

          <nav aria-label="Yönetim menüsü" style={{ marginTop: 14 }}>
            {navigation.map(item => {
              const badgeVal = item.badgeKey ? counts[item.badgeKey] : 0;
              return (
                <button
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => {
                    loadGeneration.current++;
                    setData(null);
                    setLoading(true);
                    setQuery("");
                    setFilter(item.id === "corporate-applications" ? "pending" : "");
                    setTab(item.id);
                    setMobileMenuOpen(false);
                    if (item.id === tab) void loadTab(item.id);
                  }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                  {badgeVal > 0 ? (
                    <span
                      style={{
                        background: item.id === "complaints" ? "var(--red)" : "var(--green)",
                        color: "#fff",
                        padding: "1px 7px",
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {badgeVal}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="operator" style={{ marginTop: "auto" }}>
            <span style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
              {getInitials(adminEmail)}
            </span>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              <b>{adminEmail}</b>
              <small>Sistem Yöneticisi</small>
            </div>
            <button onClick={logout} aria-label="Çıkış yap">
              Çıkış
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(new Date())}</p>
              <h1>{navigation.find(item => item.id === tab)?.label}</h1>
            </div>
            <div className="top-actions">
              <span className="api-state">
                <i /> API Bağlı
              </span>
              <button className="outline-button" onClick={() => void loadTab(tab)}>
                Verileri Yenile
              </button>
            </div>
          </header>

          {error && (
            <div className="alert error-alert" role="alert">
              <span>⚠️ {error}</span>
              <button onClick={() => setError("")}>Kapat</button>
            </div>
          )}

          {notice && (
            <div className="alert success-alert" role="status">
              <span>✅ {notice}</span>
              <button onClick={() => setNotice("")}>Kapat</button>
            </div>
          )}

          {/* Quick Filter Bar for Table Views */}
          {tab !== "corporate-wallets" && tab !== "dashboard" && tab !== "activity" && (
            <FilterBar
              tab={tab}
              query={query}
              setQuery={setQuery}
              filter={filter}
              setFilter={val => {
                setFilter(val);
                // Search will re-trigger due to filter change
              }}
              onSearch={() => void loadTab(tab)}
              counts={counts}
            />
          )}

          {/* Driver Payment Account Setting (Company Bank Info) */}
          {tab === "driver-wallets" && <DriverPaymentAccountAdmin request={request} />}

          {loading ? (
            <LoadingRows />
          ) : tab === "dashboard" ? (
            <OperationCenterView
              data={data || dashboardStats || {}}
              onFilterClick={(targetTab, targetFilter) => {
                setTab(targetTab as Tab);
                if (targetFilter !== undefined) setFilter(targetFilter);
              }}
              openDetail={openDetail}
            />
          ) : tab === "corporate-wallets" ? (
            <CorporateWalletAdmin request={request} items={data?.items || []} />
          ) : tab === "driver-wallets" ? (
            <DriverWalletAccounts
              data={data as any}
              onOpenDriver={id => void openDetail("driver", id)}
              onPage={offset => void loadTab(tab, offset)}
            />
          ) : (
            <PanelContent
              tab={tab}
              data={data}
              openDetail={openDetail}
              onProcessDeletion={handleProcessDeletionRequest}
            />
          )}
        </section>

        {/* Unified Modern Detail Drawer */}
        {detail && detailKind && (
          <DetailDrawer
            kind={detailKind}
            data={detail}
            close={() => {
              setDetail(null);
              if (tab === "driver-wallets") void loadTab(tab, data?.offset || 0);
            }}
            note={actionNote}
            setNote={setActionNote}
            busy={actionBusy}
            mutate={mutate}
            request={request}
            refresh={() => void openDetail(detailKind, detailId(detailKind, detail))}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen({
  login,
  loading,
  error,
}: {
  login: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  error: string;
}) {
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand light">
          <span>N</span>
          <div>
            NakliyeGo<small>Yönetim Merkezi</small>
          </div>
        </div>
        <div>
          <p className="eyebrow">GÜVENLİ NAKLİYE OPERASYON MERKEZİ</p>
          <h1>
            Her yükün arkasında
            <br />
            şeffaf ve güvenli bir operasyon.
          </h1>
          <p>
            Müşteri onayları, şoför belgeleri, cüzdan bakiyeleri ve nakliye süreçlerini sıfır eğitimle tek merkezden yönetin.
          </p>
        </div>
        <small>Bağımsız 256-bit şifrelenmiş yönetici oturumu</small>
      </section>
      <section className="login-form-wrap">
        <form onSubmit={login}>
          <p className="eyebrow">GÜVENLİ YÖNETİCİ GİRİŞİ</p>
          <h2>NakliyeGo Yönetim Merkezi</h2>
          <p>Lütfen yetkili yönetici kimlik bilgilerinizi girin.</p>
          {error && <div className="form-error">{error}</div>}
          <label>
            E-posta
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="admin@nakliyego.com"
            />
          </label>
          <label>
            Şifre
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              placeholder="••••••••••••"
            />
          </label>
          <button className="primary-button" disabled={loading}>
            {loading ? "Giriş Yapılıyor…" : "Yönetim Paneline Giriş Yap"}
          </button>
          <small>Bu oturum güvenliğiniz için yalnızca bu tarayıcı sekmesinde tutulur.</small>
        </form>
      </section>
    </main>
  );
}

function LoadingRows() {
  return (
    <div className="loading-card">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function OperationCenterView({
  data,
  onFilterClick,
  openDetail,
}: {
  data: AnyRecord;
  onFilterClick: (tab: string, filter?: string) => void;
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  const counts = data.counts || {};
  const max = Math.max(
    1,
    ...(data.daily || []).map((day: AnyRecord) => day.newLoads + day.newUsers + day.complaints)
  );

  // Combine verificationQueue (drivers), pending corporate applications, and open complaints into a unified prioritized queue
  const actionQueueItems: {
    id: string;
    kind: DetailKind;
    title: string;
    subtitle: string;
    badge: string;
    badgeColor: string;
    avatarChar: string;
  }[] = [];

  // 1. Pending drivers
  (data.verificationQueue || []).forEach((driver: AnyRecord) => {
    actionQueueItems.push({
      id: driver.id,
      kind: "driver",
      title: driver.name || "Şoför Başvurusu",
      subtitle: `${driver.phone || driver.email || "İletişim yok"} · Şoför Belge Doğrulaması`,
      badge: "Doğrulama Bekliyor",
      badgeColor: "badge-amber",
      avatarChar: (driver.name || "Ş")[0]?.toUpperCase() || "Ş",
    });
  });

  // 2. Pending corporate applications
  (data.pendingCorporateItems || []).forEach((corp: AnyRecord) => {
    const name = corp.companyName || corp.company?.name || corp.name || "Kurumsal Firma";
    actionQueueItems.push({
      id: corp.id,
      kind: "corporate-application",
      title: name,
      subtitle: `${corp.authorizedPerson || corp.company?.authorizedPerson || "Yetkili"} · Vergi No: ${corp.taxNumber || corp.company?.taxNumber || "—"}`,
      badge: "Firma Onayı Bekliyor",
      badgeColor: "badge-blue",
      avatarChar: "🏢",
    });
  });

  // 3. Open complaints
  (data.openComplaintItems || []).forEach((item: AnyRecord) => {
    const comp = item.complaint || item;
    actionQueueItems.push({
      id: comp.id,
      kind: "complaint",
      title: `Şikâyet: ${getLabel(comp.reason)}`,
      subtitle: `${item.reporter?.name || "Kullanıcı"} ➔ ${item.reportedUser?.name || "Kullanıcı"}`,
      badge: "Müdahale Gerekli",
      badgeColor: "badge-red",
      avatarChar: "⚠️",
    });
  });

  return (
    <div>
      {/* 6-Core Actionable Metric Cards */}
      <OperationMetrics counts={counts} onFilterClick={onFilterClick} />

      {/* Prioritized Action Queue with drivers, corporate apps, and complaints */}
      <ActionQueue
        items={actionQueueItems as any}
        onOpenItem={(kind, id) => openDetail(kind as DetailKind, id)}
      />

      {/* Activity Chart & Live Stats */}
      <div className="dashboard-grid" style={{ marginTop: 20 }}>
        <article className="panel activity-panel">
          <div className="panel-title">
            <div>
              <p>SON 7 GÜN</p>
              <h2>Günlük Platform Hareketi</h2>
            </div>
            <span className="badge-pill badge-green">İstatistik Grafiği</span>
          </div>
          <div className="chart">
            {(data.daily || []).map((day: AnyRecord) => {
              const total = day.newLoads + day.newUsers + day.complaints;
              return (
                <i
                  key={day.date}
                  title={`${day.date}: ${total} hareket`}
                  style={{ height: `${Math.max(10, (total / max) * 100)}%` }}
                />
              );
            })}
          </div>
          <div className="chart-labels">
            {(data.daily || []).map((day: AnyRecord) => (
              <span key={day.date}>
                {new Date(`${day.date}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "short" })}
              </span>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <div>
              <p>ÖZET İSTATİSTİKLER</p>
              <h2>Platform Genel Durumu</h2>
            </div>
          </div>
          <div className="info-grid">
            <div>
              <small>Toplam Müşteri</small>
              <b>{counts.customers || 0}</b>
            </div>
            <div>
              <small>Kayıtlı Şoför</small>
              <b>{counts.drivers || 0}</b>
            </div>
            <div>
              <small>Doğrulanmış Şoför</small>
              <b>{counts.verifiedDrivers || 0}</b>
            </div>
            <div>
              <small>Tamamlanan Taşıma</small>
              <b>{counts.completedJobs || 0}</b>
            </div>
            <div>
              <small>İptal Edilen</small>
              <b>{counts.cancelledJobs || 0}</b>
            </div>
            <div>
              <small>Aktif Yük</small>
              <b>{counts.activeLoads || 0}</b>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function PanelContent({
  tab,
  data,
  openDetail,
  onProcessDeletion,
}: {
  tab: Tab;
  data: AnyRecord | null;
  openDetail: (kind: DetailKind, id: string) => void;
  onProcessDeletion?: (id: string, action: "approve" | "reject", note?: string) => Promise<void>;
}) {
  if (!data) return <Empty title="Veri bulunamadı" />;
  if (tab === "activity") return <Activity data={data} />;
  const items = data.items || [];
  if (!items.length) return <Empty title="Bu filtreye uygun kayıt yok" />;
  if (tab === "account-deletions") return <AccountDeletionsTable items={items} onProcess={onProcessDeletion!} />;
  if (tab === "corporate-applications") return <CorporateTable items={items} openDetail={openDetail} />;
  if (tab === "users") return <UserTable items={items} openDetail={openDetail} />;
  if (tab === "drivers") return <DriverTable items={items} openDetail={openDetail} />;
  if (tab === "loads") return <LoadTable items={items} openDetail={openDetail} />;
  return <ComplaintTable items={items} openDetail={openDetail} />;
}

/* Corporate Applications Table */
function CorporateTable({
  items,
  openDetail,
}: {
  items: AnyRecord[];
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  return (
    <Table headings={["Firma adı", "Yetkili kişi", "Telefon", "Vergi numarası", "Başvuru tarihi", "Durum", ""]}>
      {items.map(item => {
        const companyName = item.companyName || item.company_name || item.company?.name || item.name || "—";
        const authorizedPerson = item.authorizedPerson || item.authorized_person || item.company?.authorizedPerson || item.name || "—";
        const phone = item.phone || item.company?.phone || "—";
        const taxNumber = item.taxNumber || item.tax_number || item.company?.taxNumber || "—";
        const corporateStatus = item.status || item.corporateStatus || "pending";
        const corporateId = item.id;

        return (
          <tr key={corporateId}>
            <td>
              <div className="person">
                <span style={{ background: "#e8f5ed", color: "var(--green)" }}>{getInitials(companyName)}</span>
                <div>
                  <b>{companyName}</b>
                  <small>{item.email}</small>
                </div>
              </div>
            </td>
            <td>{authorizedPerson}</td>
            <td>{phone}</td>
            <td>
              <code style={{ background: "#edf2ee", padding: "2px 6px", borderRadius: 4 }}>{taxNumber}</code>
            </td>
            <td>{formatDate(item.createdAt || item.created_at)}</td>
            <td>
              <StatusBadge value={corporateStatus} />
            </td>
            <td>
              <button
                className="table-action"
                onClick={() => void openDetail("corporate-application", corporateId)}
              >
                İncele
              </button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* User Table */
function UserTable({
  items,
  openDetail,
}: {
  items: AnyRecord[];
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  return (
    <Table headings={["Kullanıcı", "Rol / Tür", "Telefon", "Kayıt", "Hesap Durumu", ""]}>
      {items.map(user => (
        <tr key={user.id}>
          <td>
            <div className="person">
              <span>{getInitials(user.name)}</span>
              <div>
                <b>{user.name}</b>
                <small>{user.email}</small>
              </div>
            </div>
          </td>
          <td>
            {getLabel(user.role)}
            {user.role === "customer" ? (
              <small className="cell-sub">{getLabel(user.accountType)}</small>
            ) : null}
          </td>
          <td>{user.phone || "—"}</td>
          <td>{formatDate(user.createdAt)}</td>
          <td>
            <StatusBadge value={user.accountStatus} />
          </td>
          <td>
            <button className="table-action" onClick={() => void openDetail("user", user.id)}>
              İncele
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

/* Driver Table */
function DriverTable({
  items,
  openDetail,
}: {
  items: AnyRecord[];
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  return (
    <Table headings={["Şoför", "Araç Sayısı", "Belgeler", "Son Görülme", "Doğrulama", ""]}>
      {items.map(driver => (
        <tr key={driver.id}>
          <td>
            <div className="person">
              <span style={{ background: "#edf4fe", color: "#185abc" }}>{getInitials(driver.name)}</span>
              <div>
                <b>{driver.name}</b>
                <small>{driver.phone || driver.email}</small>
              </div>
            </div>
          </td>
          <td><b>{driver.vehicleCount || 0} araç</b></td>
          <td>
            <b>{driver.documentCount || 0} belge</b>
            {driver.pendingDocuments > 0 && (
              <small style={{ display: "block", color: "var(--amber)", fontWeight: 600 }}>
                ({driver.pendingDocuments} onay bekliyor)
              </small>
            )}
          </td>
          <td>{formatDate(driver.lastSeenAt)}</td>
          <td>
            <StatusBadge value={driver.verificationStatus} />
          </td>
          <td>
            <button className="table-action" onClick={() => void openDetail("driver", driver.id)}>
              Profil & Doğrula
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

/* Loads Table */
function LoadTable({
  items,
  openDetail,
}: {
  items: AnyRecord[];
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  return (
    <Table headings={["İlan Başlığı", "Güzergah (Nereden ➔ Nereye)", "Müşteri", "Tutar", "Durum", ""]}>
      {items.map(item => {
        const load = item?.load ?? (item?.id ? item : null);
        if (!load?.id) return null;
        return (
          <tr key={load.id}>
            <td>
              <b>{load.title || "Nakliye İlanı"}</b>
              <small className="cell-sub">{load.id.slice(0, 8)}</small>
            </td>
            <td>
              <b>{load.pickup?.city || "—"}</b> {load.pickup?.district ? `(${load.pickup.district})` : ""}
              {" ➔ "}
              <b>{load.delivery?.city || "—"}</b> {load.delivery?.district ? `(${load.delivery.district})` : ""}
            </td>
            <td>{item.customer?.name || "—"}</td>
            <td>
              <b style={{ color: "var(--green)" }}>{formatMoney(load.agreedPriceTl || load.basePriceTl)}</b>
            </td>
            <td>
              <StatusBadge value={load.status} />
            </td>
            <td>
              <button className="table-action" onClick={() => void openDetail("load", load.id)}>
                Detay
              </button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* Complaint Table */
function ComplaintTable({
  items,
  openDetail,
}: {
  items: AnyRecord[];
  openDetail: (kind: DetailKind, id: string) => void;
}) {
  return (
    <Table headings={["Şikâyet Nedeni", "Bildiren", "Şikâyet Edilen", "İlgili Mesaj / Not", "Durum", ""]}>
      {items.map(item => {
        const complaint = item?.complaint ?? (item?.id && item?.reason ? item : null);
        if (!complaint?.id) return null;
        return (
          <tr key={complaint.id}>
            <td>
              <b>{getLabel(complaint.reason)}</b>
              <small className="cell-sub">{formatDate(complaint.createdAt)}</small>
            </td>
            <td>{item?.reporter?.name || "—"}</td>
            <td>{item?.reportedUser?.name || "—"}</td>
            <td className="message-cell">{item?.message?.body || complaint.description || "Medya veya konuşma"}</td>
            <td>
              <StatusBadge value={complaint.status} />
            </td>
            <td>
              <button className="table-action" onClick={() => void openDetail("complaint", complaint.id)}>
                İncele
              </button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* Account Deletions Table */
function AccountDeletionsTable({
  items,
  onProcess,
}: {
  items: AnyRecord[];
  onProcess: (id: string, action: "approve" | "reject", note?: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    if (action === "approve") {
      if (!adminNote.trim()) {
        window.alert("Kayıtlı iletişim kanalı üzerinden kimlik doğrulama yöntemini işlem notuna yazın.");
        return;
      }
      const confirmed = window.confirm(
        "Talep sahibinin kimliğini kayıtlı iletişim kanalı üzerinden bağımsız olarak doğruladınız mı? Hesap kapatılacak; finansal ve yasal saklama incelemesindeki kayıtlar korunacaktır."
      );
      if (!confirmed) return;
    }
    setBusyId(id);
    try {
      await onProcess(id, action, adminNote);
      setSelectedId(null);
      setAdminNote("");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Table headings={["Tarih", "İletişim", "Kullanıcı ID / Rol", "Gerekçe", "Durum", "İşlem Notu", "Aksiyon"]}>
      {items.map(req => {
        const isPending = req.status === "pending";
        const isSelected = selectedId === req.id;
        return (
          <tr key={req.id}>
            <td>{formatDate(req.createdAt)}</td>
            <td>
              <div><b>{req.email || "—"}</b></div>
              <small className="cell-sub">{req.phone || "—"}</small>
            </td>
            <td>
              <code>{req.userId ? req.userId.slice(0, 8) : "—"}</code>
              {req.role ? <small className="cell-sub">{getLabel(req.role)}</small> : null}
            </td>
            <td>
              <span>{req.reason || "Belirtilmedi"}</span>
              {req.details ? <small className="cell-sub" style={{ display: "block" }}>{req.details}</small> : null}
            </td>
            <td><StatusBadge value={req.status} /></td>
            <td>
              {req.processedAt ? (
                <div>
                  <small>{formatDate(req.processedAt)}</small>
                  {req.adminNote ? <div style={{ fontSize: "12px", color: "var(--muted)" }}>{req.adminNote}</div> : null}
                </div>
              ) : isSelected ? (
                <input
                  type="text"
                  placeholder="Yönetici doğrulama notu (zorunlu)..."
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  style={{ width: "100%", padding: "4px 8px", fontSize: "12px", borderRadius: 4, border: "1px solid var(--line)" }}
                />
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td>
              {isPending ? (
                isSelected ? (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", minWidth: 200 }}>
                    <button
                      className="primary-button"
                      style={{ background: "#dc2626", borderColor: "#dc2626", padding: "6px 10px", fontSize: "12px", minHeight: "34px" }}
                      disabled={busyId === req.id}
                      onClick={() => void handleAction(req.id, "approve")}
                    >
                      {busyId === req.id ? "İşleniyor…" : "Onayla & Kapat"}
                    </button>
                    <button
                      className="outline-button"
                      style={{ padding: "6px 10px", fontSize: "12px", minHeight: "34px" }}
                      disabled={busyId === req.id}
                      onClick={() => void handleAction(req.id, "reject")}
                    >
                      Reddet
                    </button>
                    <button
                      className="outline-button"
                      style={{ padding: "6px 10px", fontSize: "12px", minHeight: "34px" }}
                      onClick={() => setSelectedId(null)}
                    >
                      İptal
                    </button>
                  </div>
                ) : (
                  <button
                    className="table-action"
                    onClick={() => {
                      setSelectedId(req.id);
                      setAdminNote("");
                    }}
                  >
                    İşlem Yap
                  </button>
                )
              ) : (
                <span className="muted" style={{ fontSize: "12px" }}>Tamamlandı</span>
              )}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* Activity / Audit Log Table */
function Activity({ data }: { data: AnyRecord }) {
  const totals = data.stats?.totals || {};
  return (
    <>
      <div className="metric-grid compact-metrics">
        {[
          ["Toplam Kullanıcı", totals.users],
          ["Toplam İlan", totals.loads],
          ["Mesajlar", totals.messages],
          ["Teklifler", totals.offers],
          ["Şikâyetler", totals.complaints],
        ].map(([title, value]) => (
          <article key={String(title)}>
            <p>{title}</p>
            <strong>{String(value ?? 0)}</strong>
          </article>
        ))}
      </div>
      <Table headings={["Zaman", "İşlem Türü", "Aktör", "Kayıt ID", "Ayrıntı"]}>
        {(data.items || []).map((event: AnyRecord) => (
          <tr key={`${event.id}-${event.type}`}>
            <td>{formatDate(event.createdAt)}</td>
            <td><b>{event.type}</b></td>
            <td>{event.actorId || "system"}</td>
            <td><code>{event.aggregateId?.slice(0, 12) || "—"}</code></td>
            <td className="activity-detail">{event.payload ? JSON.stringify(event.payload) : "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function Table({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return (
    <div className="table-card">
      <div className="table-scroll-container">
        <table>
          <thead>
            <tr>
              {headings.map(title => (
                <th key={title}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <div className="empty">
      <span style={{ fontSize: 28 }}>🔍</span>
      <b>{title}</b>
      <small>Filtreleri veya arama kriterlerini değiştirerek tekrar deneyebilirsiniz.</small>
    </div>
  );
}

function detailId(kind: DetailKind, data: AnyRecord) {
  return kind === "driver"
    ? data.user?.id || data.id
    : kind === "load"
    ? data.load?.id || data.id
    : kind === "complaint"
    ? data.complaint?.id || data.id
    : kind === "corporate-application"
    ? data.id || data.corporateId || data.corporate_id || data.company?.ownerCustomerId || data.company?.id
    : data.id;
}

function DetailDrawer({
  kind,
  data,
  close,
  note,
  setNote,
  busy,
  mutate,
  request,
  refresh,
}: {
  kind: DetailKind;
  data: AnyRecord;
  close: () => void;
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  mutate: (path: string, payload: AnyRecord, success: string, refreshDetail?: [DetailKind, string]) => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<any>;
  refresh: () => void;
}) {
  const id = detailId(kind, data);
  const title =
    kind === "corporate-application"
      ? (data.companyName || data.company_name || data.company?.name || data.name || "Kurumsal Başvuru")
      : kind === "driver"
      ? (data.user?.name || data.name || "Şoför Profili")
      : kind === "load"
      ? (data.load?.title || data.title || "Nakliye İlanı")
      : kind === "complaint"
      ? getLabel(data.complaint?.reason || data.reason)
      : (data.name || "Kullanıcı Profili");

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside className="drawer" aria-modal="true" role="dialog">
        <header>
          <div>
            <p>
              {kind === "corporate-application"
                ? "KURUMSAL HESAP İNCELEME"
                : kind === "driver"
                ? "ŞOFÖR YÖNETİMİ & DOĞRULAMA"
                : kind === "load"
                ? "NAKLİYE İLAN DETAYI"
                : kind === "complaint"
                ? "ŞİKÂYET İNCELEME"
                : "KULLANICI DETAYI"}
            </p>
            <h2>{title}</h2>
          </div>
          <button onClick={close} aria-label="Detayı kapat">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          {kind === "corporate-application" && (
            <CorporateDetailDrawer
              data={data}
              note={note}
              setNote={setNote}
              busy={busy}
              mutate={mutate}
              request={request}
            />
          )}

          {kind === "driver" && (
            <DriverDetailDrawer
              data={data}
              note={note}
              setNote={setNote}
              busy={busy}
              mutate={mutate}
              request={request}
              refresh={refresh}
            />
          )}

          {kind === "load" && (
            <LoadDetailDrawer
              data={data}
              note={note}
              setNote={setNote}
              busy={busy}
              mutate={mutate}
            />
          )}

          {kind === "user" && (
            <UserDetailView
              user={data}
              request={request}
              note={note}
              setNote={setNote}
              busy={busy}
              mutate={mutate}
            />
          )}

          {kind === "complaint" && (
            <ComplaintDetailView
              data={data}
              note={note}
              setNote={setNote}
              busy={busy}
              mutate={mutate}
            />
          )}
        </div>

        <footer>
          <code>ID: {id}</code>
          <button className="outline-button" onClick={close}>
            Kapat
          </button>
        </footer>
      </aside>
    </div>
  );
}

function UserDetailView({ user, request, note, setNote, busy, mutate }: any) {
  const blocked = user.accountStatus === "blocked";
  return (
    <>
      <div className="person" style={{ marginBottom: 14 }}>
        <span>{getInitials(user.name)}</span>
        <div>
          <b>{user.name}</b>
          <small>{user.email}</small>
        </div>
      </div>
      <div className="info-grid">
        <div><small>Rol</small><b>{getLabel(user.role)}</b></div>
        <div><small>Hesap türü</small><b>{user.role === "customer" ? getLabel(user.accountType) : "—"}</b></div>
        <div><small>Telefon</small><b>{user.phone || "—"}</b></div>
        <div><small>Kayıt Tarihi</small><b>{formatDate(user.createdAt)}</b></div>
        <div><small>Son Görülme</small><b>{formatDate(user.lastSeenAt)}</b></div>
        <div><small>Hesap Durumu</small><b>{getLabel(user.accountStatus)}</b></div>
      </div>

      {user.accountType === "corporate" && user.company ? (
        <section style={{ marginTop: 18 }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>Kurumsal Hesap Bilgileri</h4>
          <div className="info-grid">
            <div><small>Firma</small><b>{user.company.name}</b></div>
            <div><small>Yetkili</small><b>{user.company.authorizedPerson}</b></div>
            <div><small>Vergi No</small><b>{user.company.taxNumber || "—"}</b></div>
            <div><small>Vergi Dairesi</small><b>{user.company.taxOffice || "—"}</b></div>
            <div><small>Firma Telefonu</small><b>{user.company.phone || "—"}</b></div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>{user.company.address || "Firma adresi girilmedi."}</p>
          <div style={{ marginTop: 14 }}>
            <WalletCustomer customerId={user.id} request={request} />
          </div>
        </section>
      ) : null}

      <div className="action-box" style={{ marginTop: 18 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>
          {blocked ? "Hesabı Yeniden Aktifleştir" : "Kullanıcıyı Engelle"}
        </h4>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
          {blocked
            ? "Kullanıcı yeniden giriş yapabilir ve sistem özelliklerini kullanabilir."
            : "Kullanıcının aktif oturumları sonlandırılır ve sisteme erişimi engellenir."}
        </p>
        {!blocked && (
          <textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Engelleme nedeni (zorunludur)..."
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 70, marginBottom: 10 }}
          />
        )}
        <button
          className={blocked ? "primary-button" : "danger-button"}
          disabled={busy || (!blocked && !note.trim())}
          onClick={() =>
            void mutate(
              `/users/${user.id}/status`,
              { status: blocked ? "active" : "blocked", reason: note },
              blocked ? "Kullanıcı aktifleştirildi." : "Kullanıcı engellendi."
            )
          }
        >
          {blocked ? "✓ Yeniden Aktifleştir" : "✕ Hesabı Engelle"}
        </button>
      </div>
    </>
  );
}

function ComplaintDetailView({ data, note, setNote, busy, mutate }: any) {
  const complaint = data.complaint || data;
  const [removeMessage, setRemoveMessage] = useState(false);

  return (
    <>
      <div className="info-grid">
        <div><small>Şikâyet Eden</small><b>{data.reporter?.name || "—"}</b></div>
        <div><small>Şikâyet Edilen</small><b>{data.reportedUser?.name || "—"}</b></div>
        <div><small>Neden</small><b>{getLabel(complaint.reason)}</b></div>
        <div><small>Tarih</small><b>{formatDate(complaint.createdAt)}</b></div>
        <div><small>İlan</small><b>{data.load?.title || "—"}</b></div>
        <div><small>Durum</small><b>{getLabel(complaint.status)}</b></div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>Şikâyet Açıklaması</h4>
        <blockquote style={{ margin: 0, padding: "10px 14px", background: "#fafbfa", borderLeft: "3px solid var(--amber)", borderRadius: 6, fontSize: 13 }}>
          {complaint.description || complaint.detail || "Açıklama belirtilmemiş."}
        </blockquote>
      </div>

      {complaint.messageId && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>Şikâyet Edilen Mesaj</h4>
          <div className="reported-message">
            <small>{data.message?.senderRole ? getLabel(data.message.senderRole) : "Konuşma"}</small>
            <p>{data.message?.body || "Mesaj içeriği yüklenemedi veya silinmiş."}</p>
            <time>{formatDate(data.message?.createdAt || complaint.createdAt)}</time>
          </div>
        </div>
      )}

      <div className="action-box" style={{ marginTop: 18 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>Şikâyeti Çöz & Karara Bağla</h4>
        <textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Yönetici inceleme notu / karar gerekçesi..."
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, minHeight: 70, marginBottom: 10 }}
        />
        {complaint.messageId && (
          <label className="check" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={removeMessage}
              onChange={event => setRemoveMessage(event.target.checked)}
            />
            Mesaj içeriğini kullanıcı sohbetinden sil
          </label>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() =>
              void mutate(
                `/complaints/${complaint.id}`,
                { status: "reviewing", adminNote: note, removeMessage: false },
                "Şikâyet incelemeye alındı."
              )
            }
          >
            İncelemeye Al
          </button>
          <button
            className="primary-button"
            disabled={busy || !note.trim()}
            onClick={() =>
              void mutate(
                `/complaints/${complaint.id}`,
                { status: "resolved", adminNote: note, removeMessage },
                "Şikâyet çözüldü."
              )
            }
          >
            ✓ Çözüldü Olarak İşaretle
          </button>
          <button
            className="outline-button"
            disabled={busy || !note.trim()}
            onClick={() =>
              void mutate(
                `/complaints/${complaint.id}`,
                { status: "rejected", adminNote: note, removeMessage: false },
                "Şikâyet reddedildi."
              )
            }
          >
            ✕ Reddet
          </button>
        </div>
      </div>
    </>
  );
}
