import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where mtgtoolbox keeps its files.
 *
 * Follows the XDG base directory variables when they are set, and falls back to
 * the conventional `~/.cache` and `~/.config` otherwise. macOS gets the same
 * treatment as Linux deliberately: these are developer-facing dotfiles, and a
 * config under `~/.config` is far easier to find and back up than one
 * buried in `~/Library/Application Support`.
 */

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
};

export function cacheDir(): string {
  const base = env('XDG_CACHE_HOME') ?? join(homedir(), '.cache');
  return join(base, 'mtgtoolbox');
}

export function configDir(): string {
  const base = env('XDG_CONFIG_HOME') ?? join(homedir(), '.config');
  return join(base, 'mtgtoolbox');
}

export function cardCacheDir(): string {
  return join(cacheDir(), 'cards');
}

export function imageCacheDir(): string {
  return join(cacheDir(), 'images');
}

export function printsCacheDir(): string {
  return join(cacheDir(), 'prints');
}

/** Resolution order: explicit flag, then environment, then the default path. */
export function configPath(override?: string): string {
  return override ?? env('MTGTOOLBOX_CONFIG') ?? join(configDir(), 'config.json');
}
