"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Tab = "dashboard" | "users" | "drivers" | "loads" | "complaints" | "activity";
type DetailKind = "user" | "driver" | "load" | "complaint";
type AnyRecord = Record<string, any>;

const API_BASE = (process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8080/api/admin").replace(/\/$/, "");

const navigation: { id: Tab; label: string; mark: string }[] = [
  { id: "dashboard", label: "Genel bakış", mark: "01" },
  { id: "users", label: "Kullanıcılar", mark: "02" },
  { id: "drivers", label: "Şoför doğrulama", mark: "03" },
  { id: "loads", label: "İlanlar", mark: "04" },
  { id: "complaints", label: "Şikâyetler", mark: "05" },
  { id: "activity", label: "Hareketler", mark: "06" },
];

const labels: Record<string, string> = {
  customer: "Müşteri", driver: "Şoför", active: "Aktif", blocked: "Engelli",
  pending: "Bekliyor", verified: "Doğrulandı", rejected: "Reddedildi",
  draft: "TASLAK", published: "YAYINDA", offers_received: "YAYINDA", open: "Açık",
  driver_selected: "ŞOFÖR SEÇİLDİ", driver_en_route: "ŞOFÖR YOLA ÇIKTI", at_pickup: "YÜKLEME NOKTASINDA",
  picked_up: "YÜK ALINDI", en_route_to_delivery: "TESLİM NOKTASINA GİDİYOR", in_transit: "TESLİM NOKTASINA GİDİYOR",
  delivered: "TESLİM EDİLDİ", completed: "TAMAMLANDI", cancelled: "İPTAL EDİLDİ",
  admin: "Yönetici", customer_app: "Müşteri uygulaması", driver_app: "Şoför uygulaması", system: "Sistem", offer_acceptance: "Teklif kabulü",
  reviewing: "İnceleniyor", resolved: "Çözüldü", dismissed: "Reddedildi",
  identity: "Kimlik", driver_license: "Sürücü belgesi", vehicle_registration: "Ruhsat",
  insurance: "Sigorta", criminal_record: "Adli sicil", other: "Diğer",
  payment_dispute: "Ödeme anlaşmazlığı", behavior: "Davranış", damage: "Hasar", no_show: "Gelmeme",
  incorrect_load_info: "Yanlış yük bilgisi", safety: "Güvenlik",
  harassment: "Taciz", fraud: "Dolandırıcılık", spam: "Spam", inappropriate: "Uygunsuz içerik", privacy: "Gizlilik",
};

const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const formatMoney = (value?: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value || 0);
const label = (value?: string) => labels[value || ""] || value || "—";
const initials = (name?: string) => (name || "NA").split(" ").slice(0, 2).map(part => part[0]).join("").toUpperCase();

const nextLoadStatus: Record<string, string> = {
  driver_selected: "driver_en_route", driver_en_route: "at_pickup", at_pickup: "picked_up",
  picked_up: "en_route_to_delivery", en_route_to_delivery: "delivered", delivered: "completed",
};

function adminLoadStatusOptions(load: AnyRecord) {
  if (["completed", "cancelled"].includes(load.status)) return [];
  const options = [];
  const next = nextLoadStatus[load.status];
  if (next) options.push(next);
  options.push("cancelled");
  return [...new Set(options)];
}

function Status({ value }: { value?: string }) {
  return <span className={`status status-${value || "pending"}`}>{label(value)}</span>;
}

export default function AdminPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<AnyRecord | null>(null);
  const [detail, setDetail] = useState<AnyRecord | null>(null);
  const [detailKind, setDetailKind] = useState<DetailKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [actionNote, setActionNote] = useState("");

  useEffect(() => {
    setToken(sessionStorage.getItem("nakliye-admin-token") || "");
    setAdminEmail(sessionStorage.getItem("nakliye-admin-email") || "");
    setHydrated(true);
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    if (response.status === 401) {
      sessionStorage.removeItem("nakliye-admin-token");
      setToken("");
      throw new Error("Oturum süresi doldu. Lütfen yeniden giriş yapın.");
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || "İşlem tamamlanamadı.");
    return body;
  }, [token]);

  const pathForTab = useCallback((target: Tab) => {
    const params = new URLSearchParams();
    if (query && target !== "dashboard" && target !== "activity") params.set("q", query);
    if (filter) {
      if (target === "drivers") params.set("verificationStatus", filter);
      else if (target === "users" || target === "loads" || target === "complaints") params.set("status", filter);
    }
    const suffix = params.size ? `?${params}` : "";
    return target === "dashboard" ? "/dashboard" : target === "activity" ? "/activity?limit=80" : `/${target}${suffix}`;
  }, [filter, query]);

  const loadTab = useCallback(async (target: Tab) => {
    if (!token) return;
    setLoading(true); setError(""); setNotice(""); setDetail(null); setDetailKind(null);
    try {
      if (target === "activity") {
        const [activity, stats] = await Promise.all([request(pathForTab(target)), request("/stats?days=14")]);
        setData({ ...activity, stats });
      } else {
        setData(await request(pathForTab(target)));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Veriler alınamadı.");
    } finally { setLoading(false); }
  }, [pathForTab, request, token]);

  useEffect(() => { if (hydrated && token) void loadTab(tab); }, [hydrated, token, tab, loadTab]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "Giriş yapılamadı.");
      sessionStorage.setItem("nakliye-admin-token", body.accessToken);
      sessionStorage.setItem("nakliye-admin-email", body.admin.email);
      setAdminEmail(body.admin.email); setToken(body.accessToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Giriş yapılamadı."); }
    finally { setLoading(false); }
  }

  function logout() {
    sessionStorage.removeItem("nakliye-admin-token"); sessionStorage.removeItem("nakliye-admin-email");
    setToken(""); setData(null); setDetail(null);
  }

  async function openDetail(kind: DetailKind, id: string) {
    setActionBusy(true); setError(""); setActionNote("");
    try {
      const segment = kind === "complaint" ? "complaints" : kind === "driver" ? "drivers" : kind === "load" ? "loads" : "users";
      setDetail(await request(`/${segment}/${id}`)); setDetailKind(kind);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Detay alınamadı."); }
    finally { setActionBusy(false); }
  }

  async function mutate(path: string, payload: AnyRecord, success: string, refreshDetail?: [DetailKind, string]) {
    setActionBusy(true); setError("");
    try {
      await request(path, { method: "PATCH", body: JSON.stringify(payload) });
      setNotice(success); setActionNote("");
      await loadTab(tab);
      if (refreshDetail) await openDetail(...refreshDetail);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı."); }
    finally { setActionBusy(false); }
  }

  if (!hydrated) return <div className="boot">Yönetim merkezi hazırlanıyor…</div>;
  if (!token) return <LoginScreen login={login} loading={loading} error={error} />;

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div className="brand"><span>N</span><div>NakliyeGo<small>Yönetim merkezi</small></div></div>
        <nav aria-label="Yönetim menüsü">
          {navigation.map(item => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setQuery(""); setFilter(""); setTab(item.id); }}><i>{item.mark}</i>{item.label}{item.id === "complaints" && data?.counts?.openComplaints ? <b>{data.counts.openComplaints}</b> : null}</button>)}
        </nav>
        <div className="operator"><span>{initials(adminEmail)}</span><div>{adminEmail}<small>Sistem yöneticisi</small></div><button onClick={logout} aria-label="Çıkış yap">Çıkış</button></div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p>{new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(new Date())}</p><h1>{navigation.find(item => item.id === tab)?.label}</h1></div>
          <div className="top-actions"><span className="api-state"><i /> API bağlı</span><button className="outline-button" onClick={() => void loadTab(tab)}>Verileri yenile</button></div>
        </header>
        {error && <div className="alert error-alert" role="alert">{error}<button onClick={() => setError("")}>Kapat</button></div>}
        {notice && <div className="alert success-alert" role="status">{notice}<button onClick={() => setNotice("")}>Kapat</button></div>}
        {tab !== "dashboard" && tab !== "activity" && <Toolbar tab={tab} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} search={() => void loadTab(tab)} />}
        {loading ? <LoadingRows /> : <PanelContent tab={tab} data={data} openDetail={openDetail} />}
      </section>
      {detail && detailKind && <DetailDrawer kind={detailKind} data={detail} close={() => setDetail(null)} note={actionNote} setNote={setActionNote} busy={actionBusy} mutate={mutate} request={request} refresh={() => void openDetail(detailKind, detailId(detailKind, detail))} />}
    </main>
  );
}

function LoginScreen({ login, loading, error }: { login: (event: FormEvent<HTMLFormElement>) => void; loading: boolean; error: string }) {
  return <main className="login-shell"><section className="login-story"><div className="brand light"><span>N</span><div>NakliyeGo<small>Yönetim merkezi</small></div></div><div><p className="eyebrow">OPERASYON • GÜVENLİK • DENETİM</p><h1>Her taşımanın arkasında<br />kontrollü bir operasyon var.</h1><p>Müşterileri, şoförleri ve güvenlik süreçlerini tek merkezden yönetin.</p></div><small>Mobil kullanıcı hesaplarından tamamen bağımsız yönetici erişimi</small></section><section className="login-form-wrap"><form onSubmit={login}><p className="eyebrow">YETKİLİ ERİŞİM</p><h2>Yönetim merkezine giriş</h2><p>Size özel yönetici bilgilerinizle devam edin.</p>{error && <div className="form-error">{error}</div>}<label>E-posta<input name="email" type="email" autoComplete="username" required placeholder="operasyon@nakliyego.com" /></label><label>Şifre<input name="password" type="password" autoComplete="current-password" required minLength={12} placeholder="••••••••••••" /></label><button className="primary-button" disabled={loading}>{loading ? "Kontrol ediliyor…" : "Güvenli giriş"}</button><small>Bu oturum yalnızca açık tarayıcı sekmesinde tutulur.</small></form></section></main>;
}

function Toolbar({ tab, query, setQuery, filter, setFilter, search }: { tab: Tab; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; search: () => void }) {
  const options = tab === "drivers" ? ["pending", "verified", "rejected"] : tab === "users" ? ["active", "blocked"] : tab === "complaints" ? ["open", "reviewing", "resolved", "rejected"] : ["draft", "published", "driver_selected", "driver_en_route", "at_pickup", "picked_up", "en_route_to_delivery", "delivered", "completed", "cancelled"];
  return <form className="toolbar" onSubmit={event => { event.preventDefault(); search(); }}><label><span>Arama</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === "users" ? "Ad, e-posta, telefon veya ID" : "Kayıtlarda ara"} /></label><label><span>Durum</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="">Tüm durumlar</option>{options.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label><button className="primary-button">Filtrele</button></form>;
}

function LoadingRows() { return <div className="loading-card"><span /><span /><span /><span /></div>; }

function PanelContent({ tab, data, openDetail }: { tab: Tab; data: AnyRecord | null; openDetail: (kind: DetailKind, id: string) => void }) {
  if (!data) return <Empty title="Veri bulunamadı" />;
  if (tab === "dashboard") return <Dashboard data={data} openDetail={openDetail} />;
  if (tab === "activity") return <Activity data={data} />;
  const items = data.items || [];
  if (!items.length) return <Empty title="Bu filtreye uygun kayıt yok" />;
  if (tab === "users") return <UserTable items={items} openDetail={openDetail} />;
  if (tab === "drivers") return <DriverTable items={items} openDetail={openDetail} />;
  if (tab === "loads") return <LoadTable items={items} openDetail={openDetail} />;
  return <ComplaintTable items={items} openDetail={openDetail} />;
}

function Dashboard({ data, openDetail }: { data: AnyRecord; openDetail: (kind: DetailKind, id: string) => void }) {
  const c = data.counts || {};
  const metrics = [
    ["Müşteriler", c.customers, "Kayıtlı müşteri"], ["Şoförler", c.drivers, `${c.pendingDrivers || 0} doğrulama bekliyor`],
    ["Aktif ilan", c.activeLoads, "Devam eden operasyon"], ["Açık şikâyet", c.openComplaints, "İnceleme gerektiriyor"],
    ["Doğrulanmış şoför", c.verifiedDrivers, "Operasyona hazır"], ["Tamamlanan iş", c.completedJobs, "Toplam tamamlanan"],
    ["İptal edilen", c.cancelledJobs, "Toplam iptal"],
  ];
  const max = Math.max(1, ...(data.daily || []).map((day: AnyRecord) => day.newLoads + day.newUsers + day.complaints));
  return <><div className="metric-grid">{metrics.map(([title, value, note], index) => <article key={String(title)} className={index === 3 && Number(value) > 0 ? "metric-alert" : ""}><p>{title}</p><strong>{String(value ?? 0)}</strong><small>{note}</small></article>)}</div><div className="dashboard-grid"><article className="panel activity-panel"><div className="panel-title"><div><p>SON 7 GÜN</p><h2>Günlük platform hareketi</h2></div><span>Canlı</span></div><div className="chart">{(data.daily || []).map((day: AnyRecord) => { const total = day.newLoads + day.newUsers + day.complaints; return <i key={day.date} title={`${day.date}: ${total} hareket`} style={{ height: `${Math.max(8, total / max * 100)}%` }} />; })}</div><div className="chart-labels">{(data.daily || []).map((day: AnyRecord) => <span key={day.date}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "short" })}</span>)}</div></article><article className="panel queue-panel"><div className="panel-title"><div><p>İŞLEM BEKLİYOR</p><h2>Doğrulama kuyruğu</h2></div></div>{(data.verificationQueue || []).length ? data.verificationQueue.map((driver: AnyRecord) => <button className="queue-row" key={driver.id} onClick={() => void openDetail("driver", driver.id)}><span className="avatar">{initials(driver.name)}</span><span><b>{driver.name}</b><small>{driver.email}</small></span><Status value={driver.verificationStatus} /></button>) : <Empty title="Bekleyen doğrulama yok" compact />}</article></div></>;
}

function UserTable({ items, openDetail }: { items: AnyRecord[]; openDetail: (kind: DetailKind, id: string) => void }) { return <Table headings={["Kullanıcı", "Rol", "Telefon", "Kayıt", "Hesap", ""]}>{items.map(user => <tr key={user.id}><td><Person user={user} /></td><td>{label(user.role)}</td><td>{user.phone}</td><td>{formatDate(user.createdAt)}</td><td><Status value={user.accountStatus} /></td><td><button className="table-action" onClick={() => void openDetail("user", user.id)}>İncele</button></td></tr>)}</Table>; }
function DriverTable({ items, openDetail }: { items: AnyRecord[]; openDetail: (kind: DetailKind, id: string) => void }) { return <Table headings={["Şoför", "Araç", "Belge", "Son görülme", "Doğrulama", ""]}>{items.map(driver => <tr key={driver.id}><td><Person user={driver} /></td><td>{driver.vehicleCount || 0}</td><td>{driver.documentCount || 0} <small className="muted">({driver.pendingDocuments || 0} bekliyor)</small></td><td>{formatDate(driver.lastSeenAt)}</td><td><Status value={driver.verificationStatus} /></td><td><button className="table-action" onClick={() => void openDetail("driver", driver.id)}>Doğrula</button></td></tr>)}</Table>; }
function LoadTable({ items, openDetail }: { items: AnyRecord[]; openDetail: (kind: DetailKind, id: string) => void }) { return <Table headings={["İlan", "Rota", "Müşteri", "Tutar", "Durum", ""]}>{items.map(item => { const load = item?.load ?? (item?.id ? item : null); if (!load?.id) return null; return <tr key={load.id}><td><b>{load.title || "Başlıksız ilan"}</b><small className="cell-sub">{load.id.slice(0, 8)}</small></td><td>{load.pickup?.district || load.pickup?.city || "—"} → {load.delivery?.district || load.delivery?.city || "—"}</td><td>{item.customer?.name || "—"}</td><td>{formatMoney(load.agreedPriceTl || load.basePriceTl)}</td><td><Status value={load.status} /></td><td><button className="table-action" onClick={() => void openDetail("load", load.id)}>Detay</button></td></tr>; })}</Table>; }
function ComplaintTable({ items, openDetail }: { items: AnyRecord[]; openDetail: (kind: DetailKind, id: string) => void }) { return <Table headings={["Şikâyet", "Şikâyet eden", "Şikâyet edilen", "Mesaj", "Durum", ""]}>{items.map(item => { const complaint = item?.complaint ?? (item?.id && item?.reason ? item : null); if (!complaint?.id) return null; return <tr key={complaint.id}><td><b>{label(complaint.reason)}</b><small className="cell-sub">{formatDate(complaint.createdAt)}</small></td><td>{item?.reporter?.name || "—"}</td><td>{item?.reportedUser?.name || "—"}</td><td className="message-cell">{item?.message?.body || "Silinmiş veya medya mesajı"}</td><td><Status value={complaint.status} /></td><td><button className="table-action" onClick={() => void openDetail("complaint", complaint.id)}>İncele</button></td></tr>; })}</Table>; }

function Activity({ data }: { data: AnyRecord }) {
  const totals = data.stats?.totals || {};
  return <><div className="metric-grid compact-metrics">{[["Toplam kullanıcı", totals.users], ["Toplam ilan", totals.loads], ["Mesaj", totals.messages], ["Teklif", totals.offers], ["Şikâyet", totals.complaints]].map(([title, value]) => <article key={String(title)}><p>{title}</p><strong>{String(value ?? 0)}</strong></article>)}</div><Table headings={["Zaman", "Hareket", "Aktör", "Kayıt", "Ayrıntı"]}>{(data.items || []).map((event: AnyRecord) => <tr key={`${event.id}-${event.type}`}><td>{formatDate(event.createdAt)}</td><td><b>{event.type}</b></td><td>{event.actorId || "system"}</td><td><code>{event.aggregateId?.slice(0, 12) || "—"}</code></td><td className="activity-detail">{event.payload ? JSON.stringify(event.payload) : "—"}</td></tr>)}</Table></>;
}

function Table({ headings, children }: { headings: string[]; children: React.ReactNode }) { return <div className="table-card"><table><thead><tr>{headings.map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Person({ user }: { user: AnyRecord }) { return <div className="person"><span>{initials(user.name)}</span><div><b>{user.name}</b><small>{user.email}</small></div></div>; }
function Empty({ title, compact = false }: { title: string; compact?: boolean }) { return <div className={`empty ${compact ? "compact" : ""}`}><span>✓</span><b>{title}</b><small>Filtreleri değiştirerek tekrar deneyebilirsiniz.</small></div>; }

function detailId(kind: DetailKind, data: AnyRecord) { return kind === "driver" ? data.user.id : kind === "load" ? data.load.id : kind === "complaint" ? data.complaint.id : data.id; }

function DetailDrawer({ kind, data, close, note, setNote, busy, mutate, request, refresh }: { kind: DetailKind; data: AnyRecord; close: () => void; note: string; setNote: (value: string) => void; busy: boolean; mutate: (path: string, payload: AnyRecord, success: string, refreshDetail?: [DetailKind, string]) => Promise<void>; request: (path: string, init?: RequestInit) => Promise<any>; refresh: () => void }) {
  const id = detailId(kind, data);
  const user = kind === "driver" ? data.user : kind === "user" ? data : null;
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><aside className="drawer" aria-modal="true" role="dialog"><header><div><p>{kind === "driver" ? "ŞOFÖR DOĞRULAMA" : kind === "load" ? "İLAN DETAYI" : kind === "complaint" ? "ŞİKÂYET İNCELEME" : "KULLANICI DETAYI"}</p><h2>{user?.name || data.load?.title || label(data.complaint?.reason)}</h2></div><button onClick={close} aria-label="Detayı kapat">×</button></header><div className="drawer-body">{kind === "user" && <UserDetail user={data} note={note} setNote={setNote} busy={busy} mutate={mutate} />}{kind === "driver" && <DriverDetail data={data} note={note} setNote={setNote} busy={busy} mutate={mutate} request={request} refresh={refresh} />}{kind === "load" && <LoadDetail data={data} note={note} setNote={setNote} busy={busy} mutate={mutate} />}{kind === "complaint" && <ComplaintDetail data={data} note={note} setNote={setNote} busy={busy} mutate={mutate} />}</div><footer><code>ID: {id}</code><button className="outline-button" onClick={close}>Kapat</button></footer></aside></div>;
}

function UserDetail({ user, note, setNote, busy, mutate }: any) { const blocked = user.accountStatus === "blocked"; return <><Person user={user} /><InfoGrid items={[["Rol", label(user.role)], ["Telefon", user.phone], ["Kayıt", formatDate(user.createdAt)], ["Son görülme", formatDate(user.lastSeenAt)], ["Hesap", label(user.accountStatus)], ["Doğrulama", label(user.verificationStatus)]]} /><section className="action-box"><h3>{blocked ? "Hesabı yeniden aktifleştir" : "Hesabı engelle"}</h3><p>{blocked ? "Kullanıcı yeniden oturum açabilir ve mobil akışlara erişebilir." : "Mevcut tokenlar anında geçersiz olur; yeni giriş engellenir."}</p>{!blocked && <textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Engelleme nedeni (zorunlu)" />}<button className={blocked ? "primary-button" : "danger-button"} disabled={busy || (!blocked && !note.trim())} onClick={() => void mutate(`/users/${user.id}/status`, { status: blocked ? "active" : "blocked", reason: note }, blocked ? "Kullanıcı yeniden aktifleştirildi." : "Kullanıcı engellendi.")}>{blocked ? "Yeniden aktifleştir" : "Hesabı engelle"}</button></section></>; }

function DriverDetail({ data, note, setNote, busy, mutate, request, refresh }: any) { const user = data.user; const [docForm, setDocForm] = useState({ kind: "driver_license", title: "", fileURL: "" }); async function addDocument(event: FormEvent) { event.preventDefault(); try { await request(`/drivers/${user.id}/documents`, { method: "POST", body: JSON.stringify(docForm) }); setDocForm({ kind: "driver_license", title: "", fileURL: "" }); refresh(); } catch { /* parent surfaces API state on next action */ } } return <><Person user={user} /><InfoGrid items={[["Telefon", user.phone], ["Plaka", user.driverProfile?.licensePlate || "—"], ["Hizmet bölgesi", user.driverProfile?.serviceArea || "—"], ["Tamamlanan", user.driverProfile?.completedJobs || 0], ["Puan", user.driverProfile?.rating || "—"], ["Doğrulama", label(user.verificationStatus)]]} /><section><h3>Şoför doğrulaması</h3><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="İnceleme notu / ret gerekçesi" /><div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void mutate(`/drivers/${user.id}/verification`, { status: "verified", note }, "Şoför doğrulandı.", ["driver", user.id])}>Doğrula</button><button className="danger-button" disabled={busy || !note.trim()} onClick={() => void mutate(`/drivers/${user.id}/verification`, { status: "rejected", note }, "Şoför doğrulaması reddedildi.", ["driver", user.id])}>Reddet</button></div></section><section><h3>Belgeler</h3>{(data.documents || []).map((document: AnyRecord) => <div className="review-card" key={document.id}><div><b>{document.title}</b><small>{label(document.kind)} · <a href={document.fileUrl} target="_blank" rel="noreferrer">Belgeyi aç</a></small></div><Status value={document.status} /><div className="review-actions"><button onClick={() => void mutate(`/driver-documents/${document.id}`, { status: "verified", note }, "Belge doğrulandı.", ["driver", user.id])}>Onayla</button><button disabled={!note.trim()} onClick={() => void mutate(`/driver-documents/${document.id}`, { status: "rejected", note }, "Belge reddedildi.", ["driver", user.id])}>Reddet</button></div></div>)}<form className="document-form" onSubmit={addDocument}><select value={docForm.kind} onChange={event => setDocForm({ ...docForm, kind: event.target.value })}>{["identity", "driver_license", "vehicle_registration", "insurance", "criminal_record", "other"].map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select><input required placeholder="Belge başlığı" value={docForm.title} onChange={event => setDocForm({ ...docForm, title: event.target.value })} /><input required type="url" placeholder="https:// güvenli belge adresi" value={docForm.fileURL} onChange={event => setDocForm({ ...docForm, fileURL: event.target.value })} /><button className="outline-button">Belge ekle</button></form></section><section><h3>Araçlar</h3>{(data.vehicles || []).map((vehicle: AnyRecord) => <div className="review-card" key={vehicle.id}><div><b>{vehicle.brand} {vehicle.model}</b><small>{vehicle.licensePlate} · {vehicle.capacityKg} kg</small></div><Status value={vehicle.verificationStatus} /><div className="review-actions"><button onClick={() => void mutate(`/vehicles/${vehicle.id}/verification`, { status: "verified", note }, "Araç doğrulandı.", ["driver", user.id])}>Onayla</button><button disabled={!note.trim()} onClick={() => void mutate(`/vehicles/${vehicle.id}/verification`, { status: "rejected", note }, "Araç reddedildi.", ["driver", user.id])}>Reddet</button></div></div>)}</section></>; }

function LoadDetail({ data, note, setNote, busy, mutate }: any) { const load = data.load; const options = adminLoadStatusOptions(load); const [status, setStatus] = useState(options[0] || ""); const selectedStatus = options.includes(status) ? status : options[0] || ""; return <><InfoGrid items={[["Müşteri", data.customer?.name || "—"], ["Şoför", data.driver?.name || "Atanmadı"], ["Rota", `${load.pickup?.address} → ${load.delivery?.address}`], ["Mesafe", `${load.estimatedKm || 0} km`], ["Tutar", formatMoney(load.agreedPriceTl || load.basePriceTl)], ["Durum", label(load.status)]]} /><section><h3>Durum geçmişi</h3>{(data.statusHistory || []).length ? <div className="timeline">{data.statusHistory.map((event: AnyRecord) => <div key={event.id}><i /><span><b>{label(event.toStatus)}</b><small>{formatDate(event.changedAt || event.createdAt)} · {label(event.changedByRole || event.actorRole)} · {label(event.source)}</small>{event.note && <p>{event.note}</p>}</span></div>)}</div> : <p className="muted">Bu eski kayıt için doğrulanabilir durum geçmişi bulunmuyor.</p>}</section><section className="action-box"><h3>Yönetici durum güncellemesi</h3><p>Operasyonel akış yalnızca bir sonraki adıma veya iptale geçirilebilir.</p>{options.length ? <select value={selectedStatus} onChange={event => setStatus(event.target.value)}>{options.map(value => <option key={value} value={value}>{label(value)}</option>)}</select> : <p className="muted">Bu durum terminaldir; başka bir duruma geçirilemez.</p>}<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="İşlem notu (zorunlu)" /><button className={selectedStatus === "cancelled" ? "danger-button" : "primary-button"} disabled={busy || !selectedStatus || !note.trim()} onClick={() => void mutate(`/loads/${load.id}/status`, { status: selectedStatus, note }, "İlan durumu güncellendi.")}>Durumu güncelle</button></section></>; }

function ComplaintDetail({ data, note, setNote, busy, mutate }: any) { const complaint = data.complaint; const [removeMessage, setRemoveMessage] = useState(false); return <><InfoGrid items={[["Şikâyet eden", data.reporter?.name || "—"], ["Şikâyet edilen", data.reportedUser?.name || "—"], ["Neden", label(complaint.reason)], ["Tarih", formatDate(complaint.createdAt)], ["İlan", data.load?.title || "—"], ["Durum", label(complaint.status)], ["İlan ID", complaint.loadId || "—"], ["Konuşma ID", complaint.conversationId || complaint.loadId || "—"], ["Mesaj ID", complaint.messageId || "İş/konuşma şikâyeti"]]} /><section><h3>Şikâyet açıklaması</h3><blockquote>{complaint.description || complaint.detail || "Açıklama eklenmemiş."}</blockquote>{(complaint.adminNote || complaint.resolutionNote) && <p className="muted">Admin notu: {complaint.adminNote || complaint.resolutionNote}</p>}</section><section><h3>{complaint.messageId ? "Şikâyet edilen mesaj" : "İlgili konuşma"}</h3><div className="reported-message"><small>{data.message?.senderRole ? label(data.message.senderRole) : "Konuşma"}</small><p>{data.message?.body || (complaint.messageId ? "Mesaj silinmiş veya medya içeriği." : `Konuşma: ${complaint.conversationId || complaint.loadId}`)}</p><time>{formatDate(data.message?.createdAt || complaint.createdAt)}</time></div></section><section className="action-box"><h3>Şikâyeti yönet</h3><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Admin notu / karar gerekçesi" />{complaint.messageId && <label className="check"><input type="checkbox" checked={removeMessage} onChange={event => setRemoveMessage(event.target.checked)} /> Mesaj içeriğini kullanıcıların sohbetinden kaldır</label>}<div className="button-row"><button className="outline-button" disabled={busy} onClick={() => void mutate(`/complaints/${complaint.id}`, { status: "reviewing", adminNote: note, removeMessage: false }, "Şikâyet incelemeye alındı.")}>İncelemeye al</button><button className="primary-button" disabled={busy || !note.trim()} onClick={() => void mutate(`/complaints/${complaint.id}`, { status: "resolved", adminNote: note, removeMessage }, "Şikâyet çözüldü.")}>Çözüldü</button><button className="outline-button" disabled={busy || !note.trim()} onClick={() => void mutate(`/complaints/${complaint.id}`, { status: "rejected", adminNote: note, removeMessage: false }, "Şikâyet reddedildi.")}>Reddet</button></div>{data.reportedUser?.id && data.reportedUser.accountStatus !== "blocked" && <button className="danger-button" disabled={busy || !note.trim()} onClick={() => void mutate(`/users/${data.reportedUser.id}/status`, { status: "blocked", reason: note }, "Şikâyet edilen kullanıcı engellendi.")}>Şikâyet edilen kullanıcıyı engelle</button>}</section></>; }

function InfoGrid({ items }: { items: [string, any][] }) { return <div className="info-grid">{items.map(([title, value]) => <div key={title}><small>{title}</small><b>{String(value ?? "—")}</b></div>)}</div>; }
