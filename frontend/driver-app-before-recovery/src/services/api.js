import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

import { apiConfigurationError, apiOrigin } from '../config/api';
import { normalizeLoadPhotos } from '../utils/presentation';

const client = axios.create({
  baseURL: apiOrigin || 'http://invalid.local',
  timeout: 15000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

let refreshing;
let memorySession;
const sessionExpiredListeners = new Set();

const tokens = async () => memorySession || ({
  accessToken: await SecureStore.getItemAsync('accessToken'),
  refreshToken: await SecureStore.getItemAsync('refreshToken'),
});

const notifySessionExpired = () => {
  sessionExpiredListeners.forEach(listener => listener());
};

export const restoreSession = async () => {
  const [accessToken, refreshToken, rawUser] = await Promise.all([
    SecureStore.getItemAsync('accessToken'),
    SecureStore.getItemAsync('refreshToken'),
    SecureStore.getItemAsync('user'),
  ]);
  if (!rawUser || (!accessToken && !refreshToken)) return null;
  try {
    const user = JSON.parse(rawUser);
    if (!user?.id || user.role !== 'driver') return null;
    memorySession = { accessToken, refreshToken, user };
    return memorySession;
  } catch {
    await clearSession();
    return null;
  }
};

export const saveSession = async (session, persist = true) => {
  memorySession = session;
  if (!persist) {
    await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key)));
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync('accessToken', session.accessToken),
    SecureStore.setItemAsync('refreshToken', session.refreshToken),
    SecureStore.setItemAsync('user', JSON.stringify(session.user)),
  ]);
};

export const updateStoredUser = async user => {
  if (memorySession) memorySession = { ...memorySession, user };
  await SecureStore.setItemAsync('user', JSON.stringify(user));
};

export const clearSession = async () => {
  memorySession = undefined;
  await Promise.all(['accessToken', 'refreshToken', 'user'].map(key => SecureStore.deleteItemAsync(key)));
};

export const subscribeSessionExpired = listener => {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
};

export const logApiError = (scope, error) => {
  if (!__DEV__) return;
  console.warn(`[${scope}] request failed`, {
    method: error.config?.method,
    baseURL: error.config?.baseURL,
    url: error.config?.url,
    status: error.response?.status,
    code: error.code,
    message: error.message,
    data: error.response?.data,
  });
};

client.interceptors.request.use(async config => {
  if (apiConfigurationError) {
    return Promise.reject(Object.assign(new Error(apiConfigurationError), { code: 'API_CONFIGURATION' }));
  }
  const { accessToken } = await tokens();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (__DEV__) console.info(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
  return config;
});

client.interceptors.response.use(response => response, async error => {
  const request = error.config;
  if (error.response?.status !== 401 || request?._retried || request?.url?.includes('/auth/')) {
    return Promise.reject(error);
  }
  request._retried = true;
  try {
    refreshing ??= tokens()
      .then(({ refreshToken }) => {
        if (!refreshToken) throw new Error('Oturum yenileme anahtarı bulunamadı.');
        return client.post('/api/auth/refresh', { refreshToken });
      })
      .finally(() => { refreshing = undefined; });
    const { data } = await refreshing;
    await saveSession(data);
    request.headers.Authorization = `Bearer ${data.accessToken}`;
    return client(request);
  } catch (refreshError) {
    await clearSession();
    notifySessionExpired();
    return Promise.reject(refreshError);
  }
});

export const auth = {
  login: data => client.post('/api/auth/login', data),
  register: data => client.post('/api/auth/register', data),
  reset: data => client.post('/api/auth/password-reset', data),
  logout: async () => {
    const { refreshToken } = await tokens();
    try {
      if (refreshToken) await client.post('/api/auth/logout', { refreshToken });
    } finally {
      await clearSession();
    }
  },
};

const normalizeLoad = load => load ? { ...load, photoUrls: normalizeLoadPhotos(load.photoUrls || load.photos || load.images) } : load;
const normalizeLoadResponse = response => ({ ...response, data: { ...response.data, items: Array.isArray(response.data?.items) ? response.data.items.map(normalizeLoad) : response.data?.items } });

export const loads = {
  list: async (params = {}, request = {}) => normalizeLoadResponse(await client.get('/api/drivers/jobs/nearby', { params, signal: request.signal })),
  get: async id => { const response = await client.get(`/api/loads/${id}`); return { ...response, data: normalizeLoad(response.data) }; },
  status: (id, status) => client.patch(`/api/loads/${id}/status`, { status }),
};
export const maps = {
  reverse: async (latitude, longitude, signal) => {
    const { data } = await client.post('/api/maps/reverse-geocode', { latitude, longitude }, { signal, timeout: 12000 });
    return data.data;
  },
};
export const offers = {
  create: (id, data) => client.post(`/api/loads/${id}/offers`, data),
  list: params => client.get('/api/drivers/offers', { params }),
  update: (id, data) => client.patch(`/api/offers/${id}`, data),
  withdraw: id => client.delete(`/api/offers/${id}`),
};
export const conversations = {
  list: (params = {}, request = {}) => client.get('/api/conversations', { params, signal: request.signal }),
  get: id => client.get(`/api/conversations/${id}`),
  messages: (id, { signal, ...params } = {}) => client.get(`/api/conversations/${id}/messages`, { params, signal }),
  send: (id, data) => client.post(`/api/conversations/${id}/messages`, data),
  read: id => client.post(`/api/conversations/${id}/read`),
  removeMessage: id => client.delete(`/api/messages/${id}`),
  attachment: (id, photo, onUploadProgress) => {
    const formData = new FormData();
    formData.append('photo', { uri: photo.uri, name: photo.fileName || `chat-${Date.now()}.jpg`, type: photo.mimeType || 'image/jpeg' });
    return client.post(`/api/conversations/${id}/attachments`, formData, { timeout: 60000, onUploadProgress });
  },
};
export const profile = {
  get: () => client.get('/api/me'),
  update: data => client.patch('/api/me', data),
  changePassword: data => client.patch('/api/me/password', data),
};

export const apiError = error => {
  if (error.code === 'ERR_CANCELED') return '';
  if (error.code === 'API_CONFIGURATION') return error.message;
  if (error.code === 'ECONNABORTED') return 'İstek zaman aşımına uğradı. Sunucunun açık olduğundan emin ol.';
  if (error.message && !error.request && !error.response) return error.message;
  if (!error.response) return 'Sunucuya bağlanılamadı. İnternet bağlantınızı ve API adresini kontrol edin.';
  const { status, data } = error.response;
  const message = typeof data?.error === 'string' ? data.error : data?.error?.message || '';
  if (status === 401) return 'Oturumun sona erdi (401). Lütfen tekrar giriş yap.';
  if (status === 403) return 'Şoför yetkiniz doğrulanamadı (403).';
  if (status === 404) return message || 'İşler servisi bulunamadı (404). API adresini kontrol edin.';
  if (status === 409) return message || 'Bu bilgi zaten kayıtlı (409).';
  if (status === 422) return message || 'Form bilgilerini kontrol et (422).';
  if (status >= 500) return message || `Sunucuda bir hata oluştu (${status}). Lütfen tekrar dene.`;
  return message || `İşlem tamamlanamadı (${status}).`;
};
