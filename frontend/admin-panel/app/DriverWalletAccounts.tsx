"use client";
import { formatWalletCents } from "../../shared/walletMoney.mjs";

type Wallet = { balanceCents: number; reservedCents: number; availableCents: number };
type Driver = { id: string; name: string; phone?: string; email?: string; accountStatus?: string };
type Accounts = { items: { driver: Driver; wallet: Wallet }[]; total: number; offset: number; limit: number; summary: { fundedCount: number; reservedCount: number } };
export default function DriverWalletAccounts({ data, onOpenDriver, onPage }: { data: Accounts | null; onOpenDriver: (id: string) => void; onPage: (offset: number) => void }) {
  if (!data || !Array.isArray(data.items) || !data.summary || !Number.isSafeInteger(data.summary.fundedCount) || !Number.isSafeInteger(data.summary.reservedCount)) return <div className="empty"><b>Hesaplar yüklenemedi.</b><small>Verileri yenileyerek tekrar deneyin.</small></div>;
  return <>
    <div className="metric-grid driver-wallet-metrics">
      <article><p>Şoför hesabı</p><strong>{data.total}</strong></article>
      <article><p>Bakiyesi olan</p><strong>{data.summary.fundedCount}</strong></article>
      <article><p>Blokesi olan</p><strong>{data.summary.reservedCount}</strong></article>
    </div>
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-title"><div><h3>Şoför hesap kontrolü</h3><p>Bakiyeler, blokeler ve hesap hareketleri</p></div></div>
      <p>Hesap detayında bakiye yükleyebilir; komisyon tahsilatlarını ve bloke iadelerini inceleyebilirsin.</p>
      <div className="table-card"><div className="table-scroll"><table>
        <thead><tr><th>Şoför</th><th>Toplam bakiye</th><th>Bloke</th><th>Kullanılabilir</th><th>Hesap</th></tr></thead>
        <tbody>{data.items.map(({ driver, wallet }) => <tr key={driver.id}>
          <td><b>{driver.name}</b><small className="cell-sub">{driver.phone || driver.email || driver.id}</small>{driver.accountStatus === "blocked" ? <small className="status status-blocked">Engellenmiş hesap</small> : null}</td>
          <td>{formatWalletCents(wallet.balanceCents)}</td><td>{formatWalletCents(wallet.reservedCents)}</td><td>{formatWalletCents(wallet.availableCents)}</td>
          <td><button className="table-action" onClick={() => onOpenDriver(driver.id)}>Hesabı yönet</button></td>
        </tr>)}</tbody>
      </table></div></div>
      {!data.items.length ? <p>Bu filtreye uygun şoför hesabı yok.</p> : null}
      <div className="button-row" style={{ marginTop: 16 }}>
        <button className="outline-button" disabled={data.offset <= 0} onClick={() => onPage(Math.max(0, data.offset - data.limit))}>Önceki</button>
        <span>{data.total ? data.offset + 1 : 0}–{Math.min(data.offset + data.items.length, data.total)} / {data.total}</span>
        <button className="outline-button" disabled={data.offset + data.limit >= data.total} onClick={() => onPage(data.offset + data.limit)}>Sonraki</button>
      </div>
    </section>
  </>;
}
