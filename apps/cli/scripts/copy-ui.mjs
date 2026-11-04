import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The workshop page is a file, not a module, so `tsc` leaves it behind.
 *
 * It is copied rather than inlined into a TypeScript string so that it stays an
 * HTML file an editor can lint and a browser can reload without a build.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src/workshop/ui.html');
const to = join(root, 'dist/workshop/ui.html');

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
