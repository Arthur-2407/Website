import { useState, useEffect, useRef } from 'react';
import { logger } from '@utils/logger';

interface HealthResponse {
  status: 'healthy' | 'degraded';
  services?: {
    database?: string;
    redis?: string;
  };
  degradedMode?: {
    overall: string;
    degradedServices: string[];
  };
  circuitBreakers?: Record<string, { state: string }>;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * OBSERVABILITY: Degraded Mode Banner
 *
 * Polls the backend /health endpoint every 30s.
 * - Shows a sticky amber warning banner when status !== 'healthy'
 * - Auto-hides when the system recovers
 * - First poll runs immediately on mount
 * - Shows which specific services are impacted
 * - Uses Axios `api` instance to leverage the dev proxy (avoids CORS)
 */
export function DegradedModeBanner() {
  const [isDegraded, setIsDegraded] = useState(false);
  const [degradedServices, setDegradedServices] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkHealth = async () => {
    // Cancel any in-flight health check before starting a new one
    abortRef.current?.abort();

    try {
      // HEALTH-FIX: Use native fetch so request goes to /health (Nginx proxy → backend:3001/health).
      // The shared `api` Axios instance prepends /api, causing /api/health → 404.
      const controller = new AbortController();
      abortRef.current = controller;
      const rawRes = await fetch('/health', { signal: controller.signal });
      if (!rawRes.ok) throw new Error(`Health endpoint returned ${rawRes.status}`);
      const data: HealthResponse = await rawRes.json();

      if (data.status !== 'healthy') {
        // V3: Use degradedMode field if available for richer service info
        const impacted: string[] = data.degradedMode?.degradedServices
          || [];
        if (impacted.length === 0) {
          if (data.services?.database && data.services.database !== 'connected') impacted.push('Database');
          if (data.services?.redis && !data.services.redis.includes('connected')) impacted.push('Redis');
        }

        // V3: Add circuit breaker info
        if (data.circuitBreakers) {
          for (const [name, cb] of Object.entries(data.circuitBreakers)) {
            if (cb.state === 'OPEN' && !impacted.includes(name)) {
              impacted.push(`${name} (circuit open)`);
            }
          }
        }

        setDegradedServices(impacted);
        setIsDegraded(true);
        setDismissed(false);
        logger.warn('System health degraded', { services: data.services, degradedMode: data.degradedMode });
      } else {
        setIsDegraded(false);
        setDegradedServices([]);
      }
    } catch (err: any) {
      // Ignore abort errors (component unmount or overlapping polls)
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;

      setIsDegraded(true);
      setDegradedServices(['API Server']);
      logger.warn('Health check endpoint unreachable — system may be offline');
    }
  };

  useEffect(() => {
    checkHealth(); // immediate first check
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, []);

  if (!isDegraded || dismissed) return null;

  const serviceList = degradedServices.length > 0
    ? ` Affected: ${degradedServices.join(', ')}.`
    : '';

  return (
    <div
      id="degraded-mode-banner"
      role="alert"
      aria-live="polite"
      style={{
        position:        'fixed',
        top:             0,
        left:            0,
        right:           0,
        zIndex:          9999,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        gap:             '1rem',
        padding:         '0.6rem 1.25rem',
        background:      'linear-gradient(90deg, #78350f, #92400e)',
        color:           '#fef3c7',
        fontFamily:      'Inter, system-ui, sans-serif',
        fontSize:        '0.875rem',
        fontWeight:      500,
        boxShadow:       '0 2px 8px rgba(0,0,0,0.3)',
        borderBottom:    '1px solid #b45309',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1rem' }}>⚠️</span>
        <span>
          <strong>System running in degraded mode.</strong>
          {serviceList}
          {' '}Some features may be limited. The system will recover automatically.
        </span>
      </div>

      <button
        id="degraded-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss degraded mode banner"
        style={{
          background:   'transparent',
          border:       '1px solid #d97706',
          borderRadius: '4px',
          color:        '#fef3c7',
          cursor:       'pointer',
          padding:      '0.2rem 0.6rem',
          fontSize:     '0.8rem',
          whiteSpace:   'nowrap',
          flexShrink:   0,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

export default DegradedModeBanner;
