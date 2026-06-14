/**
 * OBSERVABILITY: Frontend Structured Logger
 *
 * Thin wrapper that provides structured logging for the frontend.
 * - In development: passes through to console with structured context
 * - In production: ready to swap console output for an external sink
 *   (e.g. Sentry, Datadog, Cloudwatch RUM) — just replace the transport functions
 *
 * Usage:
 *   import { logger } from '@utils/logger';
 *
 *   logger.info('User logged in', { employeeId, role });
 *   logger.warn('Slow API response', { url, responseTimeMs });
 *   logger.error('Component crashed', { error: err.message });
 *   logger.apiError({ url, method, status, retryCount, errorMessage });
 */

import { sentry } from './sentry';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

interface ApiErrorContext {
  url: string;
  method: string;
  status?: number;
  retryCount?: number;
  errorMessage?: string;
  errorCode?: string;
}

interface UICrashContext {
  errorMessage: string;
  componentStack?: string;
  errorBoundary?: string;
}

// ─── Transport ────────────────────────────────────────────────────────────────
// In production, replace these with calls to your error tracking service.
// Currently: structured JSON to console (easily greppable in browser DevTools).
const IS_DEV = import.meta.env.DEV;

function buildEntry(level: LogLevel, message: string, meta: LogMeta = {}) {
  return {
    timestamp:  new Date().toISOString(),
    level,
    service:    'frontend',
    env:        import.meta.env.MODE,
    message,
    ...meta,
  };
}

function apiEndpoint(path: string) {
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (!base) return normalizedPath;
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }

  return `${base}${normalizedPath}`;
}

function transport(level: LogLevel, message: string, meta: LogMeta = {}) {
  const entry = buildEntry(level, message, meta);

  if (IS_DEV) {
    // Human-readable in development
    const fn = level === 'error' ? console.error
             : level === 'warn'  ? console.warn
             : level === 'debug' ? console.debug
             : console.info;
    fn(`[${entry.timestamp.slice(11, 19)}] ${level.toUpperCase()}: ${message}`, meta);
  } else {
    // Structured output in production — replace with external sink here
    const fn = level === 'error' || level === 'warn' ? console.warn : console.info;
    fn(JSON.stringify(entry));
  }

  // Optional Sentry capturing
  if (sentry.isActive()) {
    if (level === 'error') {
      sentry.captureException(new Error(message), meta);
    } else if (level === 'warn') {
      sentry.captureMessage(message, 'warning', meta);
    }
  }

  // Real-time error forwarding to backend monitor
  if (level === 'error' || level === 'warn') {
    fetch(apiEndpoint('/api/dev/frontend-error'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(entry),
    }).catch(() => {
      // Fail silently to prevent infinite error logging loops
    });
  }
}

// ─── Public Logger API ────────────────────────────────────────────────────────
export const logger = {
  debug(message: string, meta?: LogMeta) { transport('debug', message, meta); },
  info(message: string,  meta?: LogMeta) { transport('info',  message, meta); },
  warn(message: string,  meta?: LogMeta) { transport('warn',  message, meta); },
  error(message: string, meta?: LogMeta) { transport('error', message, meta); },

  /**
   * Log a failed API call with full observability context (url, method, status, retryCount).
   * Called from the Axios response interceptor on every non-retried failure.
   */
  apiError(ctx: ApiErrorContext) {
    transport('error', `API error: ${ctx.method} ${ctx.url}`, {
      url:          ctx.url,
      method:       ctx.method,
      status:       ctx.status,
      retryCount:   ctx.retryCount  ?? 0,
      errorMessage: ctx.errorMessage,
      errorCode:    ctx.errorCode,
    });
  },

  /**
   * Log a React UI crash from ErrorBoundary.componentDidCatch.
   * Dispatches an 'app:ui-crash' custom event for any external monitoring listener.
   */
  uiCrash(ctx: UICrashContext) {
    transport('error', `UI crash: ${ctx.errorMessage}`, {
      errorMessage:   ctx.errorMessage,
      componentStack: ctx.componentStack,
      errorBoundary:  ctx.errorBoundary ?? 'ErrorBoundary',
    });

    // Emit event so any external monitoring module can capture it
    window.dispatchEvent(new CustomEvent('app:ui-crash', { detail: ctx }));
  },
};
