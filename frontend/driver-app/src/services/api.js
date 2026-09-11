import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

import { apiConfigurationError, apiOrigin } from '../config/api';
import { normalizeLoadPhotos } from '../utils/presentation';

const client = axios.create({
  baseURL: apiOrigin || 'http://invalid.local',
  timeout: 15000,
  headers: { Accept: 'application/json' },
});

let refreshing;
let memorySession;
let shouldPersistSession = false;
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
  if (!rawUser || (!accessToken && !refreshToken)) { await clearSession(); return null; }
  try {
    const user = JSON.parse(rawUser);
    if (!user?.id || user.role !== 'driver') { await clearSession(); return null; }
    shouldPersistSession = true;
    memorySession = { accessToken, refreshToken, user };
    return memorySession;
  } catch (error) {
    if (__DEV__) console.warn('[DRIVER AUTH HYDRATION] Stored user is invalid.', { message: error?.message });
    await clearSession();
    return null;
  }
};

export const saveSession = async (session, persist = shouldPersistSession) => {
  memorySession = session;
  shouldPersistSession = persist;
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
  if (shouldPersistSession) await SecureStore.setItemAsync('user', JSON.stringify(user));
};

export const clearSession = async () => {
  memorySession = undefined;
  shouldPersistSession = false;
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
    requestId: error.response?.headers?.['x-request-id'] || error.response?.data?.requestId,
  });
};

if (__DEV__ && apiOrigin) console.info(`[API] Base URL: ${apiOrigin}`);

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
        if (!refreshToken) throw Object.assign(new Error('Oturum yenileme anahtarı bulunamadı.'), { code: 'SESSION_EXPIRED' });
        return client.post('/api/auth/refresh', { refreshToken });
      })
      .finally(() => { refreshing = undefined; });
    const { data } = await refreshing;
    await saveSession(data);
    request.headers.Authorization = `Bearer ${data.accessToken}`;
    return client(request);
  } catch (refreshError) {
    const terminal = refreshError.code === 'SESSION_EXPIRED' || [400, 401].includes(refreshError.response?.status);
    if (terminal) {
      await clearSession();
      notifySessionExpired();
    }
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
const getAllLoadPages = async (params = {}, request = {}) => {
  const pageSize = 100;
  const initialOffset = Math.max(0, Number(params.offset) || 0);
  let offset = initialOffset;
  let firstResponse;
  const items = [];
  let total = 0;
  do {
    const response = await client.get('/api/drivers/jobs/nearby', { params: { ...params, offset, limit: pageSize }, signal: request.signal });
    firstResponse ||= response;
    const pageItems = Array.isArray(response.data?.items) ? response.data.items.map(normalizeLoad) : [];
    items.push(...pageItems);
    total = Number(response.data?.total) || items.length;
    offset += pageItems.length;
    if (!pageItems.length) break;
  } while (offset < total);
  return { ...firstResponse, data: { ...firstResponse.data, items, total, offset: initialOffset, limit: items.length } };
};

export const loads = {
  list: getAllLoadPages,
  get: async id => { const response = await client.get(`/api/loads/${id}`); return { ...response, data: normalizeLoad(response.data) }; },
  status: (id, status) => client.patch(`/api/loads/${id}/status`, { status }),
  completeDelivery: (id, { code, photo }) => {
    const formData = new FormData();
    formData.append('code', code);
    formData.append('photo', { uri: photo.uri, name: photo.fileName || `delivery-${Date.now()}.jpg`, type: photo.mimeType || 'image/jpeg' });
    return client.post(`/api/loads/${id}/complete-delivery`, formData, { timeout: 60000 });
  },
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
export const profile = {
  get: () => client.get('/api/me'),
  update: data => client.patch('/api/me', data),
  changePassword: data => client.patch('/api/me/password', data),
};
export const support = {
  list: () => client.get('/api/complaints/mine'),
  get: id => client.get(`/api/complaints/${id}`),
  create: data => client.post('/api/complaints', data),
};
export const push = { register: (token, platform) => client.post('/api/push/token', { token, platform }), unregister: token => client.delete('/api/push/token', { data: { token } }) };
export const documents = {
  list: () => client.get('/api/driver/documents'),
  get: id => client.get(`/api/driver/documents/${id}`),
};
export const vehicles = {
  list: () => client.get('/api/driver/vehicles'),
  create: data => client.post('/api/driver/vehicles', data),
  update: (id, data) => client.patch(`/api/driver/vehicles/${id}`, data),
  delete: id => client.delete(`/api/driver/vehicles/${id}`),
  activate: id => client.patch(`/api/driver/vehicles/${id}/activate`),
};
export const media = {
  photo: photo => {
    const formData = new FormData();
    formData.append('photo', { uri: photo.uri, name: photo.fileName || `vehicle-${Date.now()}.jpg`, type: photo.mimeType || 'image/jpeg' });
    return client.post('/api/photos', formData, { timeout: 60000 });
  },
};

export const apiError = error => {
  return normalizeApiError(error).messageWithRequestId;
};

export const normalizeApiError = error => {
  const requestId = error.response?.headers?.['x-request-id'] || error.response?.data?.requestId || '';
  const withRequestId = message => requestId ? `${message} (Destek kodu: ${requestId})` : message;
  if (error.code === 'ERR_CANCELED') return { type: 'UNKNOWN_ERROR', message: '', messageWithRequestId: '', requestId };
  if (error.code === 'API_CONFIGURATION') return { type: 'UNKNOWN_ERROR', message: error.message, messageWithRequestId: error.message, requestId };
  if (error.code === 'ECONNABORTED') { const message = 'İstek zaman aşımına uğradı. Sunucunun açık olduğundan emin ol.'; return { type: 'TIMEOUT', message, messageWithRequestId: withRequestId(message), requestId }; }
  if (error.message && !error.request && !error.response) return { type: 'UNKNOWN_ERROR', message: error.message, messageWithRequestId: withRequestId(error.message), requestId };
  if (!error.response) { const message = 'Sunucuya bağlanılamadı. İnternet bağlantınızı ve API adresini kontrol edin.'; return { type: 'NO_NETWORK', message, messageWithRequestId: message, requestId }; }
  const { status, data } = error.response;
  const message = typeof data?.error === 'string' ? data.error : data?.error?.message || '';
  const byStatus = {
    400: ['VALIDATION_ERROR', message || 'Form bilgilerini kontrol et.'],
    401: ['UNAUTHORIZED', 'Oturumun sona erdi. Lütfen tekrar giriş yap.'],
    403: ['FORBIDDEN', message || 'Şoför yetkiniz doğrulanamadı.'],
    404: ['NOT_FOUND', message || 'İstenen kayıt bulunamadı.'],
    409: ['VALIDATION_ERROR', message || 'Bu bilgi zaten kayıtlı.'],
    422: ['VALIDATION_ERROR', message || 'Form bilgilerini kontrol et.'],
  };
  const [type, normalizedMessage] = byStatus[status] || (status >= 500 ? ['SERVER_ERROR', message || 'Sunucuda bir hata oluştu. Lütfen tekrar dene.'] : ['UNKNOWN_ERROR', message || 'İşlem tamamlanamadı.']);
  return { type, message: normalizedMessage, messageWithRequestId: withRequestId(normalizedMessage), requestId, status };
};
