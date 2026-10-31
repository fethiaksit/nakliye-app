/**
 * Lightweight browser/client error reporting for NakliyeGo Admin Panel.
 * Captures uncaught window exceptions and unhandled promise rejections,
 * scrubbing sensitive tokens and authentication headers before sending.
 */

interface SentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
}

class AdminSentry {
  private dsn: string = "";
  private apiURL: string = "";
  private authHeader: string = "";
  private environment: string = "development";
  private release: string = "1.0.0";
  private initialized: boolean = false;

  public init(options?: SentryOptions) {
    const dsn = options?.dsn || (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SENTRY_DSN : "") || "";
    if (!dsn || this.initialized) return;

    try {
      const parsed = this.parseDSN(dsn);
      this.dsn = dsn;
      this.apiURL = parsed.apiURL;
      this.authHeader = parsed.authHeader;
      this.environment = options?.environment || (typeof process !== "undefined" ? process.env.NODE_ENV : "development") || "development";
      this.release = options?.release || "admin-1.0.0";
      this.initialized = true;

      this.attachGlobalHandlers();
    } catch (e) {
      console.warn("[Sentry] Failed to initialize:", e);
    }
  }

  private parseDSN(dsn: string) {
    const url = new URL(dsn);
    const key = url.username;
    const pathParts = url.pathname.split("/").filter(Boolean);
    const projectId = pathParts[pathParts.length - 1];
    return {
      apiURL: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      authHeader: `Sentry sentry_version=7, sentry_client=nakliyego-admin-sentry/1.0, sentry_key=${key}`,
    };
  }

  private attachGlobalHandlers() {
    if (typeof window === "undefined") return;

    window.addEventListener("error", (event) => {
      this.captureException(event.error || new Error(event.message));
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.captureException(event.reason || new Error("Unhandled Promise Rejection"));
    });
  }

  public captureException(error: any, extra?: Record<string, any>) {
    if (!this.initialized || !this.apiURL) return;

    const message = error?.message || String(error) || "Unknown Error";
    const stack = error?.stack || "";

    const payload = {
      event_id: Math.random().toString(36).substring(2) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      environment: this.environment,
      release: this.release,
      message: { formatted: message },
      exception: {
        values: [
          {
            type: error?.name || "Error",
            value: message,
            stacktrace: {
              frames: this.parseStackTrace(stack),
            },
          },
        ],
      },
      tags: {
        location: typeof window !== "undefined" ? window.location.pathname : "",
      },
      extra: this.sanitize(extra || {}),
    };

    try {
      fetch(this.apiURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": this.authHeader,
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      /* ignore sentry transport failure */
    }
  }

  private parseStackTrace(stack: string) {
    if (!stack) return [];
    return stack
      .split("\n")
      .slice(1, 15)
      .map((line) => ({ function: line.trim() }));
  }

  private sanitize(data: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (lower.includes("token") || lower.includes("secret") || lower.includes("password") || lower.includes("auth")) {
        clean[k] = "[REDACTED]";
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }
}

export const sentry = new AdminSentry();
