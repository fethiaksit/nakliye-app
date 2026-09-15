"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { parseWalletUnits } from "../../shared/walletMoney.mjs";

type Request = (path: string, init?: RequestInit) => Promise<any>;
type Tier = {id: string; name: string; rewardRateBps: number; minCompletedJobs: number | null; minVolumeCents: number | null};
type Policy = {version: number; enabled: boolean; defaultRewardRateBps: number; minRewardRateBps: number; maxRewardRateBps: number; maxUsageBps: number; tiers: Tier[]};
type WalletView = {company: {ownerCustomerId: string; name: string}; wallet: {balanceCents: number}; summary: {enabled: boolean; totalEarnedCents: number; totalUsedCents: number; tier: string; rewardRateBps: number; overrideRateBps: number | null; maxUsageBps: number}; transactions?: {id: string; type: string; amountCents: number; balanceBeforeCents: number; balanceAfterCents: number; rewardRateBps: number; description: string; createdAt: string; actorId?: string}[]};
const money = (n: number) => new Intl.NumberFormat("tr-TR", {style:"currency", currency:"TRY"}).format(n / 100);
const types: Record<string,string> = {earn:"Kazanım",spend:"Kullanım",refund:"İade",admin_adjustment:"Yönetici düzeltmesi",expired:"Süresi dolan"};
const errorText = (e: unknown) => e instanceof Error ? e.message : "İşlem tamamlanamadı.";
function units(form: FormData, key: string): number {
  const value = parseWalletUnits(String(form.get(key) ?? ""));
  if (value === null) throw new Error("Tutar ve oranları en fazla iki ondalık hane ile girin.");
  return value;
}

export default function CorporateWalletAdmin({request, items}: {request: Request; items: WalletView[]}) {
 const validItems = (Array.isArray(items) ? items : []).filter(item =>
  typeof item?.company?.ownerCustomerId === "string" && item.company.ownerCustomerId.trim() !== "" &&
  typeof item.company.name === "string" && item.company.name.trim() !== ""
 );
 const [policy, setPolicy] = useState<Policy | null>(null);
 const [selected, setSelected] = useState<string>("");
 const [message, setMessage] = useState("");
 const [busy, setBusy] = useState(false);
 const [settingsLoading, setSettingsLoading] = useState(true);
 useEffect(() => {
  let alive=true;
  setSettingsLoading(true);setMessage("");
  request("/corporate-wallets/settings").then(p=>{
   if (!p || !Array.isArray(p.tiers) || typeof p.enabled !== "boolean" ||
    ![p.version,p.defaultRewardRateBps,p.minRewardRateBps,p.maxRewardRateBps,p.maxUsageBps].every(Number.isSafeInteger)) {
    throw new Error("Cüzdan ayarları API yanıtı geçersiz veya boş.");
   }
   if(alive)setPolicy(p);
  }).catch(e=>{if(alive){setPolicy(null);setMessage(errorText(e));}})
   .finally(()=>{if(alive)setSettingsLoading(false);});
  return()=>{alive=false;};
 },[request]);
 async function save(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (!policy) return;
  const form = new FormData(event.currentTarget);setBusy(true);setMessage("");
  try {
   const tiers=policy.tiers.map((tier,i)=>{
    const count=String(form.get(`jobs-${i}`)||"").trim();
    if(count && (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)))) throw new Error("İş sayısı pozitif tam sayı olmalıdır.");
    return {...tier,rewardRateBps:units(form,`rate-${i}`),minCompletedJobs:count?Number(count):null,minVolumeCents:String(form.get(`volume-${i}`)||"").trim()?units(form,`volume-${i}`):null};
   });
   const payload={...policy,enabled:form.get("enabled")==="on",defaultRewardRateBps:units(form,"default"),minRewardRateBps:units(form,"min"),maxRewardRateBps:units(form,"max"),maxUsageBps:units(form,"usage"),tiers};
   setPolicy(await request("/corporate-wallets/settings",{method:"PUT",body:JSON.stringify(payload)}));setMessage("Cüzdan ayarları kaydedildi.");
  }catch(e){setMessage(errorText(e));}finally{setBusy(false);}
 }
 return <div className="wallet-management">
  {message && <p role="status" className="alert">{message}</p>}
  {policy ? <form className="panel wallet-settings" onSubmit={save}>
   <h2>Kurumsal Cüzdan Yönetimi</h2>
   <label className="check"><input name="enabled" type="checkbox" defaultChecked={policy.enabled}/> Cüzdan kazanımı ve kullanımı açık</label>
   <div className="wallet-fields">{[["default","Başlangıç kazanımı (%)",policy.defaultRewardRateBps],["min","Minimum kazanım (%)",policy.minRewardRateBps],["max","Maksimum kazanım (%)",policy.maxRewardRateBps],["usage","Nakliye başına kullanım limiti (%)",policy.maxUsageBps]].map(([key,title,value])=><label key={String(key)}>{title}<input required name={String(key)} inputMode="decimal" defaultValue={Number(value)/100}/></label>)}</div>
   <h3>Seviyeler</h3><p>Eşiklerden biri sağlandığında en yüksek uygun oran uygulanır. İki eşik de boşsa seviye otomatik uygulanmaz. Başlangıç oranı üstte yönetilir.</p>
   <div className="table-card"><table><thead><tr><th>Seviye</th><th>Kazanım (%)</th><th>Tamamlanan iş sayısı</th><th>Toplam hacim (TL)</th></tr></thead><tbody>{policy.tiers.map((tier,i)=><tr key={tier.id}><td>{tier.name}</td><td><input aria-label={`${tier.name} kazanım yüzdesi`} required name={`rate-${i}`} inputMode="decimal" defaultValue={tier.rewardRateBps/100}/></td><td><input aria-label={`${tier.name} iş eşiği`} name={`jobs-${i}`} inputMode="numeric" defaultValue={tier.minCompletedJobs??""}/></td><td><input aria-label={`${tier.name} hacim eşiği`} name={`volume-${i}`} inputMode="decimal" defaultValue={tier.minVolumeCents===null?"":tier.minVolumeCents/100}/></td></tr>)}</tbody></table></div>
   <p>Oranlar %5–%20 aralığındadır. Kazanım, cüzdan indirimi sonrası ödenecek tutar üzerinden hesaplanır. Ayar değişikliği geçmiş hareketleri değiştirmez. Sistem kapalıyken iptal iadeleri devam eder.</p>
   <button className="primary-button" disabled={busy}>Ayarları kaydet</button>
  </form> : settingsLoading ? <p>Ayarlar yükleniyor…</p> : <p>Ayarlar yüklenemedi. Verileri yenile ile tekrar deneyin.</p>}
  <section className="panel"><h2>Kurumsal müşteriler</h2><label>Müşteri seçin<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Müşteri seçin</option>{validItems.map(item=><option key={item.company.ownerCustomerId} value={item.company.ownerCustomerId}>{item.company.name}</option>)}</select></label>
  {selected && <WalletCustomer key={`${selected}:${JSON.stringify(policy)}`} customerId={selected} request={request}/>}</section>
 </div>;
}

export function WalletCustomer({customerId, request}: {customerId: string; request: Request}) {
 const [view,setView]=useState<WalletView|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const retry=useRef<{signature:string;key:string}|null>(null);
 const base=`/corporate-wallets/${customerId}`;
 useEffect(()=>{let alive=true;request(base).then(v=>{if(alive)setView(v);}).catch(e=>{if(alive)setMessage(errorText(e));});return()=>{alive=false;};},[base,request]);
 async function rate(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setMessage("");
  try {const raw=String(form.get("rate")||"").trim();const value=raw?units(form,"rate"):null;
   setView(await request(`${base}/rate`,{method:"PATCH",body:JSON.stringify({rewardRateBps:value})}));setMessage("Müşteri oranı kaydedildi.");
  }catch(e){setMessage(errorText(e));}finally{setBusy(false);}
 }
 async function adjust(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const element=event.currentTarget;const form=new FormData(element);setBusy(true);setMessage("");
  try {const payload={amountCents:units(form,"amount"),description:String(form.get("description")||"").trim()};const signature=JSON.stringify(payload);
   if(!retry.current || retry.current.signature!==signature) retry.current={signature,key:crypto.randomUUID()};
   await request(`${base}/adjustments`,{method:"POST",body:JSON.stringify({...payload,idempotencyKey:retry.current.key})});
   element.reset();setMessage("Bakiye düzeltmesi kaydedildi.");setView(await request(base));retry.current=null;
  }catch(e){setMessage(errorText(e));}finally{setBusy(false);}
 }
 const s=view?.summary;
 return <div className="wallet-customer">{message&&<p role="status" className="alert">{message}</p>}{view&&s?<>
  <h3>{view.company.name}</h3><div className="info-grid">{[["Mevcut bakiye",money(view.wallet.balanceCents)],["Toplam kazanılan",money(s.totalEarnedCents)],["Toplam kullanılan (iadeler düşülmüş)",money(s.totalUsedCents)],["Mevcut seviye",s.tier],["Geçerli kazanım oranı",`%${s.rewardRateBps/100}`],["Kullanım limiti",`%${s.maxUsageBps/100}`]].map(([title,value])=><div key={title}><small>{title}</small><b>{value}</b></div>)}</div>
  <form className="wallet-fields" onSubmit={rate}><label>Müşteriye özel kazanım (%)<input key={String(s.overrideRateBps)} name="rate" inputMode="decimal" defaultValue={s.overrideRateBps===null?"":s.overrideRateBps/100} placeholder="Boş: seviye oranı"/></label><button className="outline-button" disabled={busy}>Özel oranı kaydet</button></form>
  <form className="wallet-fields" onSubmit={adjust}><label>Bakiye düzeltmesi (TL)<input required name="amount" inputMode="decimal" placeholder="Artırmak: 100, azaltmak: -100"/></label><label>İşlem gerekçesi<input required name="description" maxLength={1000}/></label><button className="primary-button" disabled={busy}>Bakiye düzeltmesini kaydet</button></form>
  <h3>Cüzdan hareket geçmişi</h3><div className="wallet-ledger">{view.transactions?.length?view.transactions.map(t=><div key={t.id}><span><b>{types[t.type]||t.type}</b><small>{t.description}<br/>{new Date(t.createdAt).toLocaleString("tr-TR")} {t.actorId?`· ${t.actorId}`:""}<br/>Bakiye: {money(t.balanceBeforeCents)} → {money(t.balanceAfterCents)}{t.type==="earn"?` · %${t.rewardRateBps/100}`:""}</small></span><strong>{money(t.amountCents)}</strong></div>):<p>Henüz hareket yok.</p>}</div>
 </>:<p>Cüzdan yükleniyor…</p>}</div>;
}
