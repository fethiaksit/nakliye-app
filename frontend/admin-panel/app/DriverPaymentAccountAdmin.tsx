"use client";
import { FormEvent, useEffect, useState } from "react";

type Account = { enabled: boolean; companyName: string; bankName: string; iban: string };
type Request = (path: string, init?: RequestInit) => Promise<any>;
const empty: Account = { enabled: false, companyName: "", bankName: "", iban: "" };

export default function DriverPaymentAccountAdmin({ request }: { request: Request }) {
  const [account, setAccount] = useState<Account>(empty);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(false); setError("");
    request("/driver-wallets/payment-account").then(value => {
      if (active) { setAccount(value); setLoaded(true); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Tahsilat hesabı yüklenemedi."); });
    return () => { active = false; };
  }, [request, attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const value = await request("/driver-wallets/payment-account", { method: "PUT", body: JSON.stringify(account) });
      setAccount(value); setMessage("Tahsilat hesabı kaydedildi. Şoförler cüzdanı yenilediğinde güncel bilgileri görecek.");
    } catch (e) { setError(e instanceof Error ? e.message : "Tahsilat hesabı kaydedilemedi."); }
    finally { setBusy(false); }
  }
  return <section className="panel" style={{ marginTop: 18 }}>
    <div className="panel-title"><div><h3>Tahsilat hesabı</h3><p>Şoförlerin bakiye yüklemek için ödeme yapacağı şirket hesabı</p></div></div>
    {!loaded ? <>{error ? <button className="outline-button" onClick={() => setAttempt(value => value + 1)}>Tekrar dene</button> : <p>Hesap bilgileri yükleniyor…</p>}</> : <form onSubmit={save} className="document-form">
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <label><input type="checkbox" checked={account.enabled} onChange={e => setAccount({ ...account, enabled: e.target.checked })} /> Mobil uygulamada tahsilat hesabını göster</label>
        <label>Alıcı şirket unvanı<input value={account.companyName} maxLength={200} required={account.enabled} onChange={e => setAccount({ ...account, companyName: e.target.value })} /></label>
        <label>Banka adı<input value={account.bankName} maxLength={100} required={account.enabled} onChange={e => setAccount({ ...account, bankName: e.target.value })} /></label>
        <label>Şirket IBAN'ı<input value={account.iban} maxLength={40} required={account.enabled} placeholder="TR…" autoCapitalize="characters" onChange={e => setAccount({ ...account, iban: e.target.value })} /></label>
        <p>Fatura, şirketin muhasebe sisteminden manuel düzenlenip şoföre iletilir. Bu ayar bakiye yüklemez; bankaya gelen ödemeyi ayrıca doğrulamalısın.</p>
        <button className="primary-button" type="submit">{busy ? "Kaydediliyor…" : "Tahsilat hesabını kaydet"}</button>
      </fieldset>
    </form>}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
