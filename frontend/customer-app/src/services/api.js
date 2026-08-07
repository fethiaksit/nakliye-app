import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { apiConfigurationError, apiOrigin } from '../config/api';
import { decodeGooglePolyline } from '../utils/polyline';

const client = axios.create({ baseURL: apiOrigin || 'http://invalid.local', timeout: 15000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
let refreshing;
let memorySession;
const sessionExpiredListeners = new Set();
const tokens = async () => memorySession || ({ accessToken: await SecureStore.getItemAsync('accessToken'), refreshToken: await SecureStore.getItemAsync('refreshToken') });
export const saveSession = async (session, persist = true) => { memorySession = session; if (persist) { await SecureStore.setItemAsync('accessToken', session.accessToken); await SecureStore.setItemAsync('refreshToken', session.refreshToken); await SecureStore.setItemAsync('user', JSON.stringify(session.user)); } else { await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key))); } };
export const clearSession = async () => { memorySession = undefined; return Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key))); };
export const subscribeSessionExpired = listener => { sessionExpiredListeners.add(listener); return () => sessionExpiredListeners.delete(listener); };
client.interceptors.request.use(async config => { if (apiConfigurationError) return Promise.reject(Object.assign(new Error(apiConfigurationError), { code: 'API_CONFIGURATION' })); const { accessToken } = await tokens(); if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`; if (__DEV__) console.info(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`); return config; });
client.interceptors.response.use(response => response, async error => {
  const request = error.config;
  if (error.response?.status !== 401 || request?._retried || request?.url?.includes('/auth/')) return Promise.reject(error);
  request._retried = true;
  try { refreshing ??= tokens().then(({ refreshToken }) => client.post('/api/auth/refresh', { refreshToken })).finally(() => { refreshing = undefined; }); const { data } = await refreshing; await saveSession(data); request.headers.Authorization = `Bearer ${data.accessToken}`; return client(request); }
  catch (refreshError) { await clearSession(); sessionExpiredListeners.forEach(listener => listener()); return Promise.reject(refreshError); }
});
export const auth = { login: data => client.post('/api/auth/login', data), register: data => client.post('/api/auth/register', data), reset: data => client.post('/api/auth/password-reset', data), logout: async () => { const { refreshToken } = await tokens(); try { await client.post('/api/auth/logout', { refreshToken }); } finally { await clearSession(); } } };
// Health deliberately uses the same Axios instance, but targets the backend
// root rather than the /api route group. Axios timeout works in Expo Go/Hermes.
export const checkApiHealth = ({ signal } = {}) => client.get('/health', { timeout: 5000, signal, headers: { Accept: 'application/json' } });
export const loads = {
  list: params => client.get('/api/loads', { params }),
  mine: params => client.get('/api/loads/mine', { params }),
  get: id => client.get(`/api/loads/${id}`),
  create: data => client.post('/api/loads', data),
  update: (id, data) => client.put(`/api/loads/${id}`, data),
  publish: id => client.post(`/api/loads/${id}/publish`),
  remove: id => client.delete(`/api/loads/${id}`),
  status: (id, status) => client.patch(`/api/loads/${id}/status`, { status }),
  photos: async (id, photos) => {
    const formData = new FormData();
    photos.forEach((photo, index) => formData.append('photos', { uri: photo.uri, name: photo.fileName || `load-${Date.now()}-${index}.jpg`, type: photo.mimeType || 'image/jpeg' }));
    return client.post(`/api/loads/${id}/photos`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
  },
  removePhoto: (id, photoId) => client.delete(`/api/loads/${id}/photos/${photoId}`),
};
export const maps = {
  autocomplete: async (input, sessionToken, signal) => {
    const { data } = await client.get('/api/maps/places/autocomplete', { params: { input, session_token: sessionToken }, signal, timeout: 12000 });
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
// still use the new Google Maps backend endpoints, never a third-party map API.
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
  attachment: (id, photo, onUploadProgress) => {
    const formData = new FormData();
    formData.append('photo', { uri: photo.uri, name: photo.fileName || `chat-${Date.now()}.jpg`, type: photo.mimeType || 'image/jpeg' });
    return client.post(`/api/conversations/${id}/attachments`, formData, { timeout: 60000, onUploadProgress });
  },
};
export const profile = { get: () => client.get('/api/me'), update: data => client.patch('/api/me', data), changePassword: data => client.patch('/api/me/password', data) };
const responseErrorMessage = data => {
  const error = data?.error;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  return '';
};
export const apiError = error => { if (error.code === 'API_CONFIGURATION') return error.message; if (error.code === 'ECONNABORTED') return 'İstek zaman aşımına uğradı. Sunucunun açık olduğundan emin ol.'; if (error.message && !error.request && !error.response) return error.message; if (!error.response) return 'Sunucuya bağlanılamadı. İnternet bağlantınızı ve API adresini kontrol edin.'; const status = error.response.status; const message = responseErrorMessage(error.response.data); if (status === 401) return 'Oturumun sona erdi. Lütfen tekrar giriş yap.'; if (status === 404) return message || 'İstenen kayıt bulunamadı.'; if (status === 409) return message || 'Bu bilgi zaten kayıtlı.'; if (status === 422) return message || 'Form bilgilerini kontrol et.'; if (status >= 500) return message || 'Sunucuda bir hata oluştu. Lütfen tekrar dene.'; return message || 'İşlem tamamlanamadı.'; };
