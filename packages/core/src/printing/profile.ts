import { z } from 'zod';

/**
 * Printing preference profiles.
 *
 * A profile expresses which *version* of a card to print. Rules are either
 * soft (`prefer` / `avoid`, applied as score adjustments) or hard (`require`,
 * applied as filters). Hard rules that exclude every candidate are relaxed
 * rather than leaving the card unprintable — see `selectPrinting`.
 */

export const PreferenceSchema = z.enum(['prefer', 'require', 'avoid', 'ignore']);
export type Preference = z.infer<typeof PreferenceSchema>;

const base = {
  /** Ordered; earlier codes score higher. */
  preferSets: z.array(z.string().toLowerCase()).optional(),
  avoidSets: z.array(z.string().toLowerCase()).optional(),
  /** Restrict candidates to these sets entirely. */
  requireSets: z.array(z.string().toLowerCase()).optional(),
  fullArt: PreferenceSchema.optional(),
  borderless: PreferenceSchema.optional(),
  /** Preferred `frame_effects` values, such as showcase or extendedart. */
  frameEffects: z.array(z.string()).optional(),
  retroFrame: PreferenceSchema.optional(),
  textless: PreferenceSchema.optional(),
  promo: PreferenceSchema.optional(),
  universesBeyond: PreferenceSchema.optional(),
  avoidSetTypes: z.array(z.string()).optional(),
  /** Reject printings whose scan is not high resolution. */
  requireHighres: z.boolean().optional(),
  lang: z.string().optional(),
  /** Score printings already held in the collection above others. */
  preferOwned: z.boolean().optional(),
};

export const ProfileSchema = z.object({
  ...base,
  /** A separate sub-policy for basic lands, which most people treat differently. */
  basics: z.object(base).optional(),
});

export type PreferenceProfile = z.infer<typeof ProfileSchema>;

export const ConfigSchema = z.object({
  defaultProfile: z.string().optional(),
  profiles: z.record(z.string(), ProfileSchema).optional(),
  /** Card name -> pinned printing. Overrides all scoring. */
  pins: z.record(z.string(), z.object({ set: z.string(), collectorNumber: z.string() })).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * The built-in baseline.
 *
 * Deliberately conservative: it rules out printings that are unreadable or that
 * print badly, and expresses no aesthetic opinion beyond that.
 */
export const DEFAULT_PROFILE: PreferenceProfile = {
  requireHighres: true,
  lang: 'en',
  textless: 'avoid',
  avoidSetTypes: ['memorabilia', 'funny', 'token'],
  preferOwned: true,
};

export function emptyConfig(): Config {
  return { defaultProfile: 'default', profiles: { default: { ...DEFAULT_PROFILE } } };
}

export function parseConfig(data: unknown): Config {
  const result = ConfigSchema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  throw new Error(`config file is invalid:\n${lines.join('\n')}`);
}

/** Layer profiles left to right, with later values winning. */
export function mergeProfiles(...profiles: (PreferenceProfile | undefined)[]): PreferenceProfile {
  const out: PreferenceProfile = {};
  for (const profile of profiles) {
    if (!profile) continue;
    for (const [key, value] of Object.entries(profile)) {
      if (value === undefined) continue;
      if (key === 'basics') {
        out.basics = { ...out.basics, ...(value as PreferenceProfile) };
      } else {
        (out as Record<string, unknown>)[key] = value;
      }
    }
  }
  return out;
}

/**
 * The profile that applies to one card.
 *
 * A basics sub-policy layers on top of the main profile rather than replacing
 * it, so shared rules such as `requireHighres` still apply to lands.
 */
export function profileFor(profile: PreferenceProfile, isBasic: boolean): PreferenceProfile {
  if (!isBasic || !profile.basics) return profile;
  return mergeProfiles(profile, profile.basics);
}
