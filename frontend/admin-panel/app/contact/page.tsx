import PublicLayout from "../components/PublicLayout";
export default function ContactPage() {
  return <PublicLayout title="İletişim ve Şirket Bilgileri" subtitle="Hukuk incelemesi bekleyen taslak">
    <p>TASLAK — Veri sorumlusunun unvanı, MERSİS/sicil, vergi, adres ve yetkili başvuru kanalları resmî kayıtlardan doğrulanıp doldurulmalıdır. Önceki doğrulanmamış bilgiler yayıma esas alınmamalıdır.</p>
    <p>Mevcut kullanıcılar uygulamadaki destek ekranından başvurabilir. Hesaba erişim yoksa <a href="/account-deletion">hesap silme talep formu</a> kullanılabilir. Talep kayıtlı iletişim kanalı üzerinden kimlik doğrulamasına tabidir.</p>
  </PublicLayout>;
}
