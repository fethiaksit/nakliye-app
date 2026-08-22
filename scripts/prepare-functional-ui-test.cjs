'use strict';

const baseURL = String(process.env.NAKLIYE_TEST_API_URL || 'http://127.0.0.1:8080/api').replace(/\/$/, '');
const password = 'GucluSifre123';

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return data;
}

async function main() {
  const seed = Number(String(Date.now()).slice(-8));
  const customerPhone = `+905${String(seed).padStart(8, '0')}1`;
  const driverPhone = `+905${String(seed).padStart(8, '0')}2`;
  const customerName = `UI Müşteri ${seed}`;
  const driverName = `UI Şoför ${seed}`;
  const customer = await request('/auth/register', { method: 'POST', body: { name: customerName, phone: customerPhone, email: `ui-customer-${seed}@example.com`, password, role: 'customer' } });
  const driver = await request('/auth/register', { method: 'POST', body: { name: driverName, phone: driverPhone, email: `ui-driver-${seed}@example.com`, password, role: 'driver' } });
  const load = await request('/loads', {
    method: 'POST',
    token: customer.accessToken,
    body: {
      title: 'UI mesajlaşma testi',
      description: 'Native tarih ve mesaj alanı kabul testi için oluşturuldu.',
      pickup: { address: 'Bornova, İzmir', latitude: 38.46, longitude: 27.21, city: 'İzmir', district: 'Bornova', country: 'Türkiye', countryCode: 'TR' },
      delivery: { address: 'Konak, İzmir', latitude: 38.42, longitude: 27.13, city: 'İzmir', district: 'Konak', country: 'Türkiye', countryCode: 'TR' },
      urgencyType: 'scheduled',
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      cargoType: 'beyaz_esya',
      vehicleType: 'kapali_kasa',
      dimensions: { lengthCm: 80, widthCm: 75, heightCm: 190, weightKg: 95 },
      pickupFloor: 3,
      deliveryFloor: 1,
      pickupElevatorAvailable: true,
      deliveryElevatorAvailable: false,
      helperNeeded: true,
      helperCount: 2,
    },
  });
  await request(`/loads/${load.id}/publish`, { method: 'POST', token: customer.accessToken });
  const offer = await request(`/loads/${load.id}/offers`, { method: 'POST', token: driver.accessToken, body: { amountTl: 3400, note: 'UI kabul testi', estimatedArrivalMinutes: 45 } });
  await request(`/offers/${offer.id}/accept`, { method: 'POST', token: customer.accessToken });
  await request(`/conversations/${load.id}/messages`, { method: 'POST', token: driver.accessToken, body: { type: 'text', body: 'Konuşma hazır.', clientMessageId: `ui-seed-${seed}` } });
  process.stdout.write(JSON.stringify({ customerName, customerPhone, driverName, driverPhone, password, loadId: load.id }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
