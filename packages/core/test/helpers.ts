import type { ScryfallCard } from '../src/scryfall/types.js';

/** Build a card object with only the fields a test cares about. */
export function card(over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: over.id ?? `${over.set ?? 'tst'}-${over.collector_number ?? '1'}`,
    name: 'Sol Ring',
    lang: 'en',
    layout: 'normal',
    released_at: '2024-01-01',
    set: 'tst',
    set_name: 'Test Set',
    set_type: 'commander',
    collector_number: '1',
    rarity: 'uncommon',
    type_line: 'Artifact',
    image_uris: { png: 'https://example.invalid/card.png' },
    full_art: false,
    border_color: 'black',
    frame: '2015',
    promo: false,
    digital: false,
    image_status: 'highres_scan',
    ...over,
  };
}
