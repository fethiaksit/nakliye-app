import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AccountBackHeader } from '../../../shared/ui/account';
import { AppButton, ListSkeleton, ScreenState, SectionCard } from '../../../shared/ui/primitives';
import { formatWalletCents } from '../../../shared/walletMoney.mjs';
import { driverWallet, apiError } from '../services/api';

const labels = { TOPUP: 'Bakiye yükleme', RESERVE: 'Hizmet bedeli blokesi', RELEASE: 'Bloke kaldırıldı', COMMISSION: 'Hizmet bedeli tahsilatı' };
export default function DriverWalletScreen({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const copy = async (value, label) => {
    try { await Clipboard.setStringAsync(value); setCopyMessage(`${label} kopyalandı.`); }
    catch { setCopyMessage('Kopyalanamadı. Bilgiyi basılı tutarak kopyalayabilirsiniz.'); }
  };
  const refresh = useCallback(async () => {
    setLoading(true); setError(''); setCopyMessage('');
    try { const response = await driverWallet.get(); setData(response.data); }
    catch (e) { setError(apiError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <>
    <AccountBackHeader title="Cüzdanım" onBack={onBack} />
    {loading ? <ListSkeleton count={3} /> : error ? <ScreenState type="error" title="Cüzdan yüklenemedi" message={error} onRetry={refresh} /> : data ? <>
      <SectionCard title="Bakiyeniz" icon="wallet-outline">
        <Text>Toplam: {formatWalletCents(data.wallet.balanceCents)}</Text>
        <Text>Bloke: {formatWalletCents(data.wallet.reservedCents)}</Text>
        <Text>Kullanılabilir: {formatWalletCents(data.wallet.availableCents)}</Text>
        <Text style={{ marginTop: 12 }}>Kabul edilen işin %10 hizmet bedeli bloke edilir. Ücret yalnızca teslimat doğrulanıp iş tamamlandığında tahsil edilir. İptalde bloke kaldırılır.</Text>
        <Text style={{ marginTop: 12 }}>Ödemeniz yönetici tarafından doğrulandıktan sonra bakiyenize eklenir.</Text>
      </SectionCard>
      <SectionCard title="Bakiye yükle" icon="business-outline">
        {data.paymentAccount?.enabled ? <>
          <Text>Alıcı şirket</Text><Text selectable style={{ fontWeight: '700', marginBottom: 12 }}>{data.paymentAccount.companyName}</Text>
          <Text>Banka</Text><Text selectable style={{ marginBottom: 12 }}>{data.paymentAccount.bankName}</Text>
          <Text>IBAN</Text><Text selectable style={{ fontWeight: '700', marginBottom: 12 }}>{data.paymentAccount.iban.replace(/(.{4})/g, '$1 ').trim()}</Text>
          <AppButton label="IBAN'ı kopyala" onPress={() => void copy(data.paymentAccount.iban, 'IBAN')} />
          <Text style={{ marginTop: 12 }}>Havale / EFT açıklaması</Text><Text selectable style={{ marginBottom: 12 }}>{data.paymentReference}</Text>
          <AppButton label="Ödeme açıklamasını kopyala" onPress={() => void copy(data.paymentReference, 'Ödeme açıklaması')} />
          <Text style={{ marginTop: 12 }}>Şirket hesabına havale / EFT yaparken açıklamaya yukarıdaki referansı yazın. Ödemeniz kontrol edildikten sonra bakiyeniz yüklenir. Faturanız şirket tarafından ayrıca düzenlenip size iletilir.</Text>
          {copyMessage ? <Text accessibilityLiveRegion="polite" style={{ marginTop: 12 }}>{copyMessage}</Text> : null}
        </> : <Text>Tahsilat hesabı henüz paylaşılmadı. Bakiye yüklemek için destek ile iletişime geçin.</Text>}
      </SectionCard>
      <SectionCard title="Cüzdan hareketleri" icon="list-outline">
        {data.transactions.length ? data.transactions.map(entry => <View key={entry.id} style={{ paddingVertical: 12 }}>
          <Text style={{ fontWeight: '700' }}>{labels[entry.type] || entry.type}: {formatWalletCents(Math.abs(entry.amountCents))}</Text>
          <Text>{new Date(entry.createdAt).toLocaleString('tr-TR')}</Text>
          {entry.loadId ? <Text>İş: {entry.loadId}</Text> : null}
          <Text>İşlem sonrası bakiye: {formatWalletCents(entry.balanceAfterCents)}</Text>
          <Text>İşlem sonrası bloke: {formatWalletCents(entry.reservedAfterCents)}</Text>
        </View>) : <Text>Henüz cüzdan hareketiniz yok.</Text>}
      </SectionCard>
      <AppButton label="Yenile" onPress={refresh} />
    </> : null}
  </>;
}
