'use client';

import { Turnstile } from '@marsidev/react-turnstile';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { forwardRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

interface TurnstileWidgetProps {
  onSuccess: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
}

/**
 * Renders the Cloudflare Turnstile widget.
 * If NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set, renders nothing (dev bypass).
 * Forward the ref to call .reset() after a failed submission.
 */
const TurnstileWidget = forwardRef<TurnstileInstance, TurnstileWidgetProps>(
  function TurnstileWidget({ onSuccess, onExpire, onError }, ref) {
    if (!SITE_KEY) return null;

    return (
      <div style={{ marginTop: 14 }}>
        <Turnstile
          ref={ref}
          siteKey={SITE_KEY}
          onSuccess={onSuccess}
          onExpire={onExpire}
          onError={onError}
          options={{ theme: 'light' }}
        />
      </div>
    );
  },
);

export default TurnstileWidget;

/** True when Turnstile is configured (site key present). */
export const turnstileEnabled = Boolean(SITE_KEY);
