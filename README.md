# mtgproxy

A local-first Magic: the Gathering proxy print-sheet generator — a CLI that turns a
decklist into a print-ready PDF at true card size, a web app for browsing and tweaking,
and a plain-file collection tracker so you only proxy the cards you don't already own.

> **Status:** in development. See [docs/PLAN.md](docs/PLAN.md) for the full architecture
> and milestones.

## Printing

Cards are laid out at **63 x 88 mm** — true Magic card size — nine to a page.

**Print at 100% scale, with "fit to page" or "shrink to fit" turned off.** Any scaling
by the print dialog makes the cards the wrong size, which is the single most common way
to waste a sheet.

## Credits

Card data and images come from the [Scryfall API](https://scryfall.com/docs/api).
This project is unaffiliated with Scryfall.

Magic: the Gathering is a trademark of Wizards of the Coast. This project is
unaffiliated with and unendorsed by Wizards of the Coast, and is intended for printing
personal playtest proxies.

## License

[MIT](LICENSE)
