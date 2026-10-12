import { Platform } from 'react-native';

/**
 * Lightweight, crash-resilient Sentry client for NakliyeGo React Native/Expo apps.
 * Sends JS exceptions and unhandled errors directly to Sentry HTTP Ingest API
 * without requiring heavy native dependencies that can break custom Expo prebuilds.
 */
class MobileSentry {
  constructor() {
    this.dsn = '';
    this.apiURL = '';
    this.authHeader = '';
    this.environment = __DEV__ ? 'development' : 'production';
    this.release = '1.0.0';
    this.appName = 'nakliyego';
    this.initialized = false;
  }

  init(options = {}) {
    const dsn = options.dsn || process.env.EXPO_PUBLIC_SENTRY_DSN || '';
    if (!dsn || this.initialized) return;

    try {
      const parsed = this.parseDSN(dsn);
      this.dsn = dsn;
      this.apiURL = parsed.apiURL;
      this.authHeader = parsed.authHeader;
      this.appName = options.appName || 'nakliyego';
      this.environment = options.environment || (__DEV__ ? 'development' : 'production');
      this.release = options.release || '1.0.0';
      this.initialized = true;

      this.attachGlobalHandlers();
    } catch (e) {
      if (__DEV__) {
        console.warn('[Sentry] Mobile init failed:', e);
      }
    }
  }

  parseDSN(dsn) {
    const match = dsn.match(/^(https?:\/\/)([^@]+)@([^/]+)\/(\d+)$/);
    if (!match) throw new Error('Invalid Sentry DSN format');
    const [_, proto, key, host, projectId] = match;
    return {
      apiURL: `${proto}${host}/api/${projectId}/store/`,
      authHeader: `Sentry sentry_version=7, sentry_client=nakliyego-mobile/1.0, sentry_key=${key}`,
    };
  }

  attachGlobalHandlers() {
    if (typeof ErrorUtils !== 'undefined' && ErrorUtils.getGlobalHandler) {
      const defaultHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error, isFatal) => {
        this.captureException(error, { isFatal });
        if (defaultHandler) {
          defaultHandler(error, isFatal);
        }
      });
    }
  }

  captureException(error, extra = {}) {
    if (!this.initialized || !this.apiURL) return;

    const message = error?.message || String(error) || 'Mobile Error';
    const stack = error?.stack || '';

    const payload = {
      event_id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: extra.isFatal ? 'fatal' : 'error',
      environment: this.environment,
      release: `${this.appName}@${this.release}`,
      message: { formatted: message },
      exception: {
        values: [
          {
            type: error?.name || 'Error',
            value: message,
            stacktrace: {
              frames: this.parseStack(stack),
            },
          },
        ],
      },
      tags: {
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        app: this.appName,
      },
      extra: this.sanitize(extra),
    };

    try {
      fetch(this.apiURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Auth': this.authHeader,
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }

  parseStack(stack) {
    if (!stack) return [];
    return stack
      .split('\n')
      .slice(0, 15)
      .map((line) => ({ function: line.trim() }));
  }

  sanitize(data) {
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (lower.includes('token') || lower.includes('secret') || lower.includes('password') || lower.includes('phone') || lower.includes('address')) {
        clean[k] = '[REDACTED]';
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }
}

export const mobileSentry = new MobileSentry();
