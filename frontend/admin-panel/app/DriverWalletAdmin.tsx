"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { parseWalletUnits, formatWalletCents } from "../../shared/walletMoney.mjs";

type Request = (path: string, init?: RequestInit) => Promise<any>;
const labels: Record<string, string> = { TOPUP: "Bakiye yükleme", RESERVE: "Bloke", RELEASE: "Bloke iadesi", COMMISSION: "Hizmet bedeli" };
export default function DriverWalletAdmin({ driverId, request }: { driverId: string; request: Request }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await request(`/drivers/${driverId}/wallet`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Cüzdan yüklenemedi."); }
    finally { setLoading(false); }
  }, [driverId, request]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function topup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const amountCents = parseWalletUnits(String(values.get("amount") || ""));
    const reference = String(values.get("reference") || "").trim();
    if (amountCents === null || amountCents <= 0 || reference.length < 3) { setError("Geçerli tutar ve ödeme referansı girin."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      setData(await request(`/drivers/${driverId}/wallet/topups`, { method: "POST", body: JSON.stringify({ amountCents, reference }) }));
      form.reset(); setMessage("Ödeme referansı kaydedildi; bakiye yüklendi. Aynı referans tekrar yükleme yapmaz.");
    } catch (e) { setError(e instanceof Error ? e.message : "Bakiye yüklenemedi."); }
    finally { setBusy(false); }
  }
  return <section><h3>Şoför cüzdanı</h3>
    {loading ? <p>Cüzdan yükleniyor…</p> : data ? <>
      <p>Toplam: <b>{formatWalletCents(data.wallet.balanceCents)}</b> · Bloke: <b>{formatWalletCents(data.wallet.reservedCents)}</b> · Kullanılabilir: <b>{formatWalletCents(data.wallet.availableCents)}</b></p>
      <p>Yalnızca alınmış ve doğrulanmış ödemeleri yükleyin. Her ödeme için benzersiz banka/dekont referansı girin.</p>
      <form onSubmit={topup} className="document-form">
        <label>Tutar (TL)<input name="amount" inputMode="decimal" required placeholder="1000,00" /></label>
        <label>Ödeme referansı<input name="reference" required minLength={3} maxLength={200} /></label>
        <button className="primary-button" disabled={busy}>Bakiye yükle</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {data.transactions.length ? <div className="table-scroll"><table><thead><tr><th>İşlem</th><th>Tutar</th><th>Bakiye</th><th>Bloke</th><th>İş / Referans</th></tr></thead><tbody>
        {data.transactions.map((e: any) => <tr key={e.id}><td>{labels[e.type] || e.type}<small>{new Date(e.createdAt).toLocaleString("tr-TR")}</small></td><td>{formatWalletCents(Math.abs(e.amountCents))}</td><td>{formatWalletCents(e.balanceAfterCents)}</td><td>{formatWalletCents(e.reservedAfterCents)}</td><td>{e.loadId || e.reference}</td></tr>)}
      </tbody></table></div> : <p>Henüz cüzdan hareketi yok.</p>}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button disabled={loading || busy} onClick={() => void refresh()}>Cüzdanı yenile</button>
  </section>;
}
