import {
  DEFAULT_PROFILE,
  mergeProfiles,
  type Config,
  type Preference,
  type PreferenceProfile,
} from '@mtgtoolbox/core';
import { loadConfig } from '@mtgtoolbox/node';
import { warn } from './ui.js';

/**
 * Assembling the profile that applies to one invocation.
 *
 * Precedence runs from weakest to strongest: the built-in baseline, then the
 * named profile from the config file, then flags given on the command line.
 */

export interface ProfileFlags {
  profile?: string;
  preferSet?: string[];
  avoidSet?: string[];
  requireSet?: string[];
  fullArt?: boolean;
  borderless?: boolean;
  retro?: boolean;
  /** commander maps `--no-ub` to this, defaulting to true. */
  ub?: boolean;
  frameEffect?: string[];
  preferOwned?: boolean;
  config?: string;
}

function flagsToProfile(flags: ProfileFlags): PreferenceProfile {
  const on = (value: boolean | undefined): Preference | undefined =>
    value === undefined ? undefined : value ? 'prefer' : 'ignore';

  return {
    ...(flags.preferSet?.length ? { preferSets: flags.preferSet.map((s) => s.toLowerCase()) } : {}),
    ...(flags.avoidSet?.length ? { avoidSets: flags.avoidSet.map((s) => s.toLowerCase()) } : {}),
    ...(flags.requireSet?.length ? { requireSets: flags.requireSet.map((s) => s.toLowerCase()) } : {}),
    ...(flags.fullArt !== undefined ? { fullArt: on(flags.fullArt) } : {}),
    ...(flags.borderless !== undefined ? { borderless: on(flags.borderless) } : {}),
    ...(flags.retro !== undefined ? { retroFrame: on(flags.retro) } : {}),
    ...(flags.ub === false ? { universesBeyond: 'avoid' as Preference } : {}),
    ...(flags.frameEffect?.length ? { frameEffects: flags.frameEffect } : {}),
    ...(flags.preferOwned !== undefined ? { preferOwned: flags.preferOwned } : {}),
  };
}

export interface ResolvedProfile {
  profile: PreferenceProfile;
  config: Config;
  configPath: string;
  /** Which named profile was used, when one was. */
  name: string | undefined;
}

export async function resolveProfile(flags: ProfileFlags): Promise<ResolvedProfile> {
  const { data: config, path } = await loadConfig(flags.config);
  const name = flags.profile ?? config.defaultProfile;
  const named = name ? config.profiles?.[name] : undefined;

  if (flags.profile && !named) {
    const available = Object.keys(config.profiles ?? {});
    warn(
      `no profile named "${flags.profile}" in ${path}` +
        (available.length ? ` (available: ${available.join(', ')})` : ''),
    );
  }

  return {
    profile: mergeProfiles(DEFAULT_PROFILE, named, flagsToProfile(flags)),
    config,
    configPath: path,
    name: named ? name : undefined,
  };
}

/** Collect repeatable option values, e.g. `--prefer-set a --prefer-set b`. */
export const collect = (value: string, previous: string[] = []): string[] => [...previous, value];
