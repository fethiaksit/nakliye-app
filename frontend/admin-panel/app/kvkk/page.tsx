import React from "react";
import PublicLayout from "../components/PublicLayout";

export const metadata = {
  title: "KVKK Aydınlatma Metni — NakliyeGo",
  description: "6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca NakliyeGo Aydınlatma Metni.",
};

export default function KVKKPage() {
  return (
    <PublicLayout
      title="6698 Sayılı KVKK Kapsamında Aydınlatma Metni"
      subtitle="Kişisel verilerinizin işlenme amaçları, hukuki sebepleri ve Kanun kapsamındaki haklarınız."
      version="1.0.0"
      updatedAt="14 Ekim 2026"
    >
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          1. Veri Sorumlusu
        </h2>
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, veri sorumlusu sıfatıyla{" "}
          <strong>Feti Akşit Limited Şirketi</strong> [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü] (“NakliyeGo”)
          olarak kişisel verilerinizi Kanun’a uygun olarak işlemekteyiz.
        </p>
        <p>
          <strong>Vergi Dairesi / VKN:</strong> Hasan Tahsin Vergi Dairesi — 3850507457<br />
          <strong>Tebligat Adresi:</strong> 6220 Sokak No: 12/A, Bornova / İzmir<br />
          <strong>İletişim:</strong> zeytinavm@gmail.com | <strong>KEP:</strong> [DOĞRULAMA GEREKLİ: KEP Adresi]
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          2. Kişisel Veri Kategorileri ve Hukuki Sebepler
        </h2>
        <p>Platformumuzda işlenen veriler ve KVKK Madde 5 dayanakları:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Kimlik ve İletişim Verileri:</strong> Ad, soyad, telefon, e-posta (Sözleşmenin kurulması ve ifası - m. 5/2-c).</li>
          <li><strong>Konum Verileri:</strong> Rota hesaplama ve aktif taşıma canlı takibi (Sözleşmenin ifası - m. 5/2-c).</li>
          <li><strong>Mesleki Belgeler (Şoför):</strong> Ehliyet, SRC ve yetki belgeleri (Hukuki yükümlülük - m. 5/2-ç).</li>
          <li><strong>Mali Kayıtlar:</strong> Fatura ve cüzdan hareketleri (TTK ve VUK gereği hukuki yükümlülük - m. 5/2-ç).</li>
          <li><strong>Erişim Logları:</strong> IP adresi ve port kayıtları (5651 sayılı Kanun - m. 5/2-ç).</li>
          <li><strong>Pazarlama ve Kampanya:</strong> Ticari elektronik ileti gönderimi (Açık Rıza - m. 5/1).</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          3. İlgili Kişinin Hakları (KVKK Madde 11)
        </h2>
        <p>Kişisel veri sahipleri olarak aşağıdaki haklara sahipsiniz:</p>
        <ol style={{ paddingLeft: 20 }}>
          <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
          <li>İşlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
          <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
          <li>KVKK 7. maddesi kapsamında silinmesini veya yok edilmesini isteme,</li>
          <li>Düzeltme veya silme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
          <li>Münhasıran otomatik sistemlerle analiz edilmesi neticesinde aleyhinize bir sonucun çıkmasına itiraz etme,</li>
          <li>Kanuna aykırı işleme sebebiyle zarara uğramanız halinde zararın giderilmesini talep etme.</li>
        </ol>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: "#14261c", borderBottom: "1px solid #edf2ee", paddingBottom: 6 }}>
          4. Başvuru Usulü
        </h2>
        <p>
          Başvurularınızı sistemimizde kayıtlı e-posta adresinizden <code>zeytinavm@gmail.com</code> adresine gönderebilir veya şirket tebligat adresimize
          yazılı dilekçe ile iletebilirsiniz. Talepleriniz en geç <strong>30 gün</strong> içinde ücretsiz olarak yanıtlanır.
        </p>
      </section>
    </PublicLayout>
  );
}
