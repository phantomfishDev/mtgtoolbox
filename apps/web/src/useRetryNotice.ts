import { useEffect, useState } from 'react';
import type { RetryInfo } from '@mtgtoolbox/core';
import { subscribeToRetries } from './platform/client.js';

/** How long a notice stays up after the retry that caused it. */
const LINGER_MS = 6000;

/**
 * The most recent retry, as a sentence to show the user.
 *
 * Clears itself, so a one-off blip during a long resolution does not leave a
 * warning stuck on screen after the work succeeds.
 */
export function useRetryNotice(): string | null {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = subscribeToRetries((info: RetryInfo) => {
      const seconds = Math.max(1, Math.round(info.waitMs / 1000));
      setNotice(
        info.reason === 'rate-limit'
          ? `Scryfall is rate-limiting us. Waiting ${seconds}s before retry ${info.attempt}.`
          : `Network problem (${info.message}). Retrying in ${seconds}s, attempt ${info.attempt}.`,
      );
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), info.waitMs + LINGER_MS);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return notice;
}
