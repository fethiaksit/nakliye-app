// Optional analytics stays disabled until a separate, reviewed consent flow exists.
class PostHogClient {
  constructor() {
    this.apiKey = '';
    this.host = 'https://eu.i.posthog.com';
    this.distinctId = '';
    this.initialized = false;
    this.featureFlags = {};
    this.flagListeners = [];
  }

  init(options = {}) {
    // No separate analytics consent exists. Keep network collection disabled.
    // Marketing preferences and KVKK acknowledgement must not enable it.
  }

  identify(userId, traits = {}) {
    if (!this.initialized || !userId) return;
    this.distinctId = String(userId);
    this.capture('$identify', {
      $set: this.sanitizeProperties(traits),
    });
    this.reloadFeatureFlags();
  }

  reset() {
    this.distinctId = '';
    this.featureFlags = {};
  }

  capture(eventName, properties = {}) {
    if (!this.initialized || !this.apiKey) return;

    const eventPayload = {
      api_key: this.apiKey,
      event: eventName,
      distinct_id: this.distinctId || 'anonymous',
      timestamp: new Date().toISOString(),
      properties: {
        ...this.defaultProps,
        ...this.sanitizeProperties(properties),
      },
    };

    try {
      fetch(`${this.host}/capture/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      }).catch(() => {});
    } catch {}
  }

  /**
   * Fetches remote feature flags with graceful degradation and safe caching.
   */
  async reloadFeatureFlags() {
    if (!this.initialized || !this.apiKey) return;

    try {
      const response = await fetch(`${this.host}/decide/?v=3`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          distinct_id: this.distinctId || 'anonymous',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.featureFlags) {
          this.featureFlags = { ...this.featureFlags, ...data.featureFlags };
          this.flagListeners.forEach(listener => {
            try { listener(this.featureFlags); } catch {}
          });
        }
      }
    } catch {
      // Offline or network error: gracefully keep using cached/default values
    }
  }

  /**
   * Evaluates feature flag with secure default fallback.
   * Defaults to enabled for standard business features (messaging, offers, create_load, corporate_wallet)
   * and disabled for maintenance/beta features.
   */
  isFeatureEnabled(flagKey, defaultValue) {
    if (this.featureFlags && typeof this.featureFlags[flagKey] !== 'undefined') {
      const val = this.featureFlags[flagKey];
      return typeof val === 'boolean' ? val : Boolean(val);
    }
    // Safe fallbacks when flags cannot be fetched
    if (typeof defaultValue !== 'undefined') {
      return defaultValue;
    }
    const safeDefaults = {
      'messaging_enabled': true,
      'offers_enabled': true,
      'create_load_enabled': true,
      'corporate_wallet_enabled': true,
      'maintenance_mode': false,
      'beta_features': false,
    };
    return safeDefaults[flagKey] ?? true;
  }

  onFeatureFlags(listener) {
    if (typeof listener === 'function') {
      this.flagListeners.push(listener);
      if (Object.keys(this.featureFlags).length > 0) {
        try { listener(this.featureFlags); } catch {}
      }
    }
  }

  /**
   * Defensive field filter; this does not make event data anonymous.
   */
  sanitizeProperties(props = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(props)) {
      const lower = key.toLowerCase();
      // Block sensitive personal and credential fields
      if (
        lower.includes('phone') ||
        lower.includes('email') ||
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('address') ||
        lower.includes('message') ||
        lower.includes('note') ||
        lower.includes('iban') ||
        lower.includes('taxnumber') ||
        lower.includes('identity')
      ) {
        continue;
      }
      clean[key] = value;
    }
    return clean;
  }
}

export const posthog = new PostHogClient();
