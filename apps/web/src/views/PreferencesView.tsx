import { useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  mergeProfiles,
  type Preference,
  type PreferenceProfile,
} from '@mtgproxy/core';
import { useApp } from '../state.js';
import { Button, Field, Panel, Select, Toggle } from '../components/ui.js';

/**
 * Edit the profile that decides which printing of each card gets used.
 *
 * Edits are written straight through to the store, because the print view reads
 * the same config and a preference that needed a separate save step would
 * silently not apply.
 */

const PREFERENCE_OPTIONS: readonly { value: Preference; label: string }[] = [
  { value: 'ignore', label: "Don't care" },
  { value: 'prefer', label: 'Prefer' },
  { value: 'avoid', label: 'Avoid' },
  { value: 'require', label: 'Require' },
];

const PROFILE_NAME = 'default';

export function PreferencesView() {
  const { config, saveConfig } = useApp();
  const [setsText, setSetsText] = useState(
    (config.profiles?.[PROFILE_NAME]?.preferSets ?? []).join(', '),
  );

  const profile = useMemo(
    () => mergeProfiles(DEFAULT_PROFILE, config.profiles?.[PROFILE_NAME]),
    [config],
  );

  async function update(patch: Partial<PreferenceProfile>) {
    const current = config.profiles?.[PROFILE_NAME] ?? {};
    await saveConfig({
      ...config,
      defaultProfile: PROFILE_NAME,
      profiles: { ...config.profiles, [PROFILE_NAME]: { ...current, ...patch } },
    });
  }

  async function commitSets(text: string) {
    const codes = text
      .split(/[,\s]+/)
      .map((code) => code.trim().toLowerCase())
      .filter(Boolean);
    await update({ preferSets: codes });
  }

  const pins = Object.entries(config.pins ?? {});

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <h2 className="mb-1 font-semibold">Which printing to use</h2>
        <p className="mb-4 text-sm text-muted">
          These apply to every card. An <em>avoid</em> outranks every positive signal, including
          preferring cards you already own.
        </p>

        <div className="flex flex-col gap-4">
          <Field label="Preferred sets, best first">
            <input
              value={setsText}
              onChange={(event) => setSetsText(event.target.value)}
              onBlur={(event) => void commitSets(event.target.value)}
              placeholder="cmm, ltc, znr"
              className="rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Full art">
            <Select
              value={profile.fullArt ?? 'ignore'}
              onChange={(fullArt) => void update({ fullArt })}
              options={PREFERENCE_OPTIONS}
            />
          </Field>

          <Field label="Borderless">
            <Select
              value={profile.borderless ?? 'ignore'}
              onChange={(borderless) => void update({ borderless })}
              options={PREFERENCE_OPTIONS}
            />
          </Field>

          <Field label="Retro frame">
            <Select
              value={profile.retroFrame ?? 'ignore'}
              onChange={(retroFrame) => void update({ retroFrame })}
              options={PREFERENCE_OPTIONS}
            />
          </Field>

          <Field label="Universes Beyond">
            <Select
              value={profile.universesBeyond ?? 'ignore'}
              onChange={(universesBeyond) => void update({ universesBeyond })}
              options={PREFERENCE_OPTIONS}
            />
          </Field>

          <Toggle
            checked={profile.preferOwned ?? true}
            onChange={(preferOwned) => void update({ preferOwned })}
            label="Prefer printings I already own"
            hint="So proxies match the copies on your shelf."
          />

          <Toggle
            checked={profile.requireHighres ?? true}
            onChange={(requireHighres) => void update({ requireHighres })}
            label="Only use high-resolution scans"
            hint="Low-resolution scans print visibly badly."
          />
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="mb-1 font-semibold">Basic lands</h2>
          <p className="mb-4 text-sm text-muted">
            A separate policy layered on top of the rules above, since a 38-land deck is mostly
            what you see.
          </p>
          <div className="flex flex-col gap-4">
            <Field label="Preferred sets for basics">
              <input
                defaultValue={(profile.basics?.preferSets ?? []).join(', ')}
                onBlur={(event) =>
                  void update({
                    basics: {
                      ...profile.basics,
                      preferSets: event.target.value
                        .split(/[,\s]+/)
                        .map((code) => code.trim().toLowerCase())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="unf, znr"
                className="rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Full art for basics">
              <Select
                value={profile.basics?.fullArt ?? 'ignore'}
                onChange={(fullArt) => void update({ basics: { ...profile.basics, fullArt } })}
                options={PREFERENCE_OPTIONS}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <h2 className="mb-1 font-semibold">Pinned printings</h2>
          <p className="mb-3 text-sm text-muted">
            Cards fixed to one exact printing, overriding everything above.
          </p>
          {pins.length === 0 ? (
            <p className="text-sm text-muted">
              None. Choose a printing in the print view, or use{' '}
              <code className="rounded bg-edge px-1">mtgproxy pin</code>.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {pins.map(([name, pin]) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  <span className="capitalize">{name}</span>
                  <span className="flex items-center gap-2 text-muted">
                    {pin.set.toUpperCase()} {pin.collectorNumber}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const next = { ...config.pins };
                        delete next[name];
                        void saveConfig({ ...config, pins: next });
                      }}
                    >
                      remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-2 font-semibold">Effective profile</h2>
          <pre className="overflow-x-auto rounded bg-surface p-3 text-xs">
            {JSON.stringify(profile, null, 2)}
          </pre>
        </Panel>
      </div>
    </div>
  );
}
