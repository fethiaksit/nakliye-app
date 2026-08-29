import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { apiConfigurationError, apiOrigin } from '../config/api';
import { decodeGooglePolyline } from '../utils/polyline';

const client = axios.create({ baseURL: apiOrigin || 'http://invalid.local', timeout: 15000, headers: { Accept: 'application/json' } });
let refreshing;
let memorySession;
let shouldPersistSession = false;
const sessionExpiredListeners = new Set();
const tokens = async () => memorySession || ({ accessToken: await SecureStore.getItemAsync('accessToken'), refreshToken: await SecureStore.getItemAsync('refreshToken') });
export const restoreSession = async () => {
  const [accessToken, refreshToken, rawUser] = await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.getItemAsync(key)));
  if (!rawUser || (!accessToken && !refreshToken)) { await clearSession(); return null; }
  try {
    const user = JSON.parse(rawUser);
    if (!user?.id || user.role !== 'customer') { await clearSession(); return null; }
    shouldPersistSession = true;
    memorySession = { accessToken, refreshToken, user };
    return memorySession;
  } catch (error) {
    if (__DEV__) console.warn('[CUSTOMER AUTH HYDRATION] Stored user is invalid.', { message: error?.message });
    await clearSession();
    return null;
  }
};
export const saveSession = async (session, persist = shouldPersistSession) => {
  memorySession = session;
  shouldPersistSession = persist;
  if (persist) {
    await Promise.all([
      SecureStore.setItemAsync('accessToken', session.accessToken),
      SecureStore.setItemAsync('refreshToken', session.refreshToken),
      SecureStore.setItemAsync('user', JSON.stringify(session.user)),
    ]);
  } else {
    await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key)));
  }
};
export const updateStoredUser = async user => {
  if (memorySession) memorySession = { ...memorySession, user };
  if (shouldPersistSession) await SecureStore.setItemAsync('user', JSON.stringify(user));
};
export const clearSession = async () => { memorySession = undefined; shouldPersistSession = false; await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key))); };
export const subscribeSessionExpired = listener => { sessionExpiredListeners.add(listener); return () => sessionExpiredListeners.delete(listener); };
export const logApiError = (scope, error) => { if (__DEV__) console.warn(`[${scope}] request failed`, { method: error.config?.method, baseURL: error.config?.baseURL, url: error.config?.url, status: error.response?.status, code: error.code, message: error.message, requestId: error.response?.headers?.['x-request-id'] }); };
if (__DEV__ && apiOrigin) console.info(`[API] Base URL: ${apiOrigin}`);
client.interceptors.request.use(async config => { if (apiConfigurationError) return Promise.reject(Object.assign(new Error(apiConfigurationError), { code: 'API_CONFIGURATION' })); const { accessToken } = await tokens(); if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`; if (__DEV__) console.info(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`); return config; });
client.interceptors.response.use(response => response, async error => {
  const request = error.config;
  if (error.response?.status !== 401 || request?._retried || request?.url?.includes('/auth/')) return Promise.reject(error);
  request._retried = true;
  try { refreshing ??= tokens().then(({ refreshToken }) => { if (!refreshToken) throw Object.assign(new Error('Oturum yenileme anahtarı bulunamadı.'), { code: 'SESSION_EXPIRED' }); return client.post('/api/auth/refresh', { refreshToken }); }).finally(() => { refreshing = undefined; }); const { data } = await refreshing; await saveSession(data); request.headers.Authorization = `Bearer ${data.accessToken}`; return client(request); }
  catch (refreshError) { const terminal = refreshError.code === 'SESSION_EXPIRED' || [400, 401].includes(refreshError.response?.status); if (terminal) { await clearSession(); sessionExpiredListeners.forEach(listener => listener()); } return Promise.reject(refreshError); }
});
export const auth = { login: data => client.post('/api/auth/login', data), register: data => client.post('/api/auth/register', data), reset: data => client.post('/api/auth/password-reset', data), logout: async () => { const { refreshToken } = await tokens(); try { await client.post('/api/auth/logout', { refreshToken }); } finally { await clearSession(); } } };
// Health deliberately uses the same Axios instance, but targets the backend
// root rather than the /api route group. Axios timeout works in Expo Go/Hermes.
export const checkApiHealth = ({ signal } = {}) => client.get('/health', { timeout: 5000, signal, headers: { Accept: 'application/json' } });
const getAllPages = async (path, params = {}, request = {}) => {
  const pageSize = 100;
  let offset = Math.max(0, Number(params.offset) || 0);
  let firstResponse;
  const items = [];
  let total = 0;
  do {
    const response = await client.get(path, { params: { ...params, offset, limit: pageSize }, signal: request.signal });
    firstResponse ||= response;
    const pageItems = Array.isArray(response.data?.items) ? response.data.items : [];
    items.push(...pageItems);
    total = Number(response.data?.total) || items.length;
    offset += pageItems.length;
    if (!pageItems.length) break;
  } while (offset < total);
  return { ...firstResponse, data: { ...firstResponse.data, items, total, offset: Math.max(0, Number(params.offset) || 0), limit: items.length } };
};
export const loads = {
  list: params => client.get('/api/loads', { params }),
  mine: (params, request) => getAllPages('/api/loads/mine', params, request),
  get: id => client.get(`/api/loads/${id}`),
  create: data => client.post('/api/loads', data),
  update: (id, data) => client.put(`/api/loads/${id}`, data),
  publish: id => client.post(`/api/loads/${id}/publish`),
  remove: id => client.delete(`/api/loads/${id}`),
  status: (id, status) => client.patch(`/api/loads/${id}/status`, { status }),
  photos: async (id, photos) => {
    const formData = new FormData();
    photos.forEach((photo, index) => formData.append('photos', { uri: photo.uri, name: photo.fileName || `load-${Date.now()}-${index}.jpg`, type: photo.mimeType || 'image/jpeg' }));
    return client.post(`/api/loads/${id}/photos`, formData, { timeout: 60000 });
  },
  removePhoto: (id, photoId) => client.delete(`/api/loads/${id}/photos/${photoId}`),
};
export const maps = {
  autocomplete: async (input, sessionToken, signal, locationBias) => {
    const { data } = await client.get('/api/maps/places/autocomplete', { params: { input, session_token: sessionToken, ...(locationBias ? { lat: locationBias.latitude, lng: locationBias.longitude } : {}) }, signal, timeout: 12000 });
    return (data.data?.items || []).map(item => ({ placeId: item.place_id, formattedAddress: item.formatted_address, primaryText: item.primary_text, secondaryText: item.secondary_text }));
  },
  placeDetails: async (placeId, sessionToken, signal) => {
    const { data } = await client.get(`/api/maps/places/${encodeURIComponent(placeId)}`, { params: { session_token: sessionToken }, signal, timeout: 12000 });
    return data.data;
  },
  reverse: async (latitude, longitude, signal) => {
    const { data } = await client.post('/api/maps/reverse-geocode', { latitude, longitude }, { signal, timeout: 12000 });
    return data.data;
  },
  calculate: async (payload, signal) => {
    const { data } = await client.post('/api/maps/routes/calculate', payload, { signal, timeout: 15000 });
    const route = data.data;
    return {
      distanceMeters: route.distance_meters,
      distanceKm: route.distance_km,
      durationSeconds: route.duration_seconds,
      durationMinutes: route.duration_minutes,
      pricePerKm: route.price_per_km,
      estimatedPrice: route.estimated_price,
      currency: route.currency,
      encodedPolyline: route.encoded_polyline,
      routeCoordinates: decodeGooglePolyline(route.encoded_polyline),
    };
  },
};
// Kept for shared conversation callers during the API rollout. These aliases
// still use the normalized backend maps endpoints and never expose a provider
// key to the mobile application.
export const locations = { reverse: (latitude, longitude, signal) => maps.reverse(latitude, longitude, signal) };
export const offers = { create: (loadId, data) => client.post(`/api/loads/${loadId}/offers`, data), list: loadId => client.get(`/api/loads/${loadId}/offers`), accept: id => client.post(`/api/offers/${id}/accept`), withdraw: id => client.delete(`/api/offers/${id}`) };
export const messages = { list: (loadId, { signal, ...params } = {}) => client.get(`/api/loads/${loadId}/messages`, { params, signal }), send: (loadId, data) => client.post(`/api/loads/${loadId}/messages`, data) };
export const conversations = {
  list: (params = {}, request = {}) => client.get('/api/conversations', { params, signal: request.signal }),
  get: id => client.get(`/api/conversations/${id}`),
  messages: (id, { signal, ...params } = {}) => client.get(`/api/conversations/${id}/messages`, { params, signal }),
  send: (id, data) => client.post(`/api/conversations/${id}/messages`, data),
  read: (id, messageIds = []) => client.post(`/api/conversations/${id}/read`, { messageIds }),
  removeMessage: id => client.delete(`/api/messages/${id}`),
  complainMessage: (id, data) => client.post(`/api/messages/${id}/complaints`, data),
  complainLoad: (id, data) => client.post(`/api/loads/${id}/complaints`, data),
  attachment: (id, photo, onUploadProgress) => {
    const formData = new FormData();
    formData.append('photo', { uri: photo.uri, name: photo.fileName || `chat-${Date.now()}.jpg`, type: photo.mimeType || 'image/jpeg' });
    return client.post(`/api/conversations/${id}/attachments`, formData, { timeout: 60000, onUploadProgress });
  },
};
export const profile = { get: () => client.get('/api/me'), update: data => client.patch('/api/me', data), changePassword: data => client.patch('/api/me/password', data) };
export const push = { register: (token, platform) => client.post('/api/push/token', { token, platform }), unregister: token => client.delete('/api/push/token', { data: { token } }) };
const responseErrorMessage = data => {
  const error = data?.error;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  return '';
};
export const normalizeApiError = error => {
  const requestId = error.response?.headers?.['x-request-id'] || error.response?.data?.requestId || '';
  if (error.code === 'ERR_CANCELED') return { type: 'UNKNOWN_ERROR', message: '', requestId };
  if (error.code === 'API_CONFIGURATION') return { type: 'UNKNOWN_ERROR', message: error.message, requestId };
  if (error.code === 'ECONNABORTED') return { type: 'TIMEOUT', message: 'İstek zaman aşımına uğradı. Sunucunun açık olduğundan emin ol.', requestId };
  if (error.message && !error.request && !error.response) return { type: 'UNKNOWN_ERROR', message: error.message, requestId };
  if (!error.response) return { type: 'NO_NETWORK', message: 'Sunucuya bağlanılamadı. İnternet bağlantınızı ve API adresini kontrol edin.', requestId };
  const status = error.response.status;
  const backendMessage = responseErrorMessage(error.response.data);
  const byStatus = {
    400: ['VALIDATION_ERROR', backendMessage || 'Form bilgilerini kontrol et.'],
    401: ['UNAUTHORIZED', 'Oturumun sona erdi. Lütfen tekrar giriş yap.'],
    403: ['FORBIDDEN', backendMessage || 'Bu işlem için yetkiniz yok.'],
    404: ['NOT_FOUND', backendMessage || 'İstenen kayıt bulunamadı.'],
    409: ['VALIDATION_ERROR', backendMessage || 'Bu bilgi zaten kayıtlı.'],
    422: ['VALIDATION_ERROR', backendMessage || 'Form bilgilerini kontrol et.'],
  };
  const [type, message] = byStatus[status] || (status >= 500 ? ['SERVER_ERROR', backendMessage || 'Sunucuda bir hata oluştu. Lütfen tekrar dene.'] : ['UNKNOWN_ERROR', backendMessage || 'İşlem tamamlanamadı.']);
  return { type, message, requestId, status };
};
export const apiError = error => { const normalized = normalizeApiError(error); return normalized.requestId ? `${normalized.message} (Destek kodu: ${normalized.requestId})` : normalized.message; };
