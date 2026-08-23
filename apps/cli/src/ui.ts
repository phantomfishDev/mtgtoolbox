/** Terminal output helpers. Colour is dropped when stderr is not a TTY. */

const ESC = String.fromCharCode(27);
const enabled = process.stderr.isTTY === true && process.env['NO_COLOR'] === undefined;

const wrap = (code: string) => (text: string) =>
  enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');

export const info = (message: string): void => console.error(message);
export const warn = (message: string): void => console.error(`${yellow('warning')} ${message}`);
export const fail = (message: string): void => console.error(`${red('error')} ${message}`);
export const done = (message: string): void => console.error(`${green('done')} ${message}`);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * A single-line progress indicator that erases itself when finished.
 * Silent on non-TTY stderr so piped output stays clean.
 */
export class Progress {
  private current = 0;

  constructor(
    private readonly label: string,
    private readonly total: number,
  ) {}

  /** Jump to an absolute count, for producers that report progress that way. */
  set(value: number): void {
    this.current = value;
    this.render();
  }

  tick(step = 1): void {
    this.current += step;
    this.render();
  }

  private render(): void {
    if (!process.stderr.isTTY) return;
    process.stderr.write(`\r${dim(`${this.label} ${this.current}/${this.total}`)}${ESC}[K`);
  }

  stop(): void {
    if (process.stderr.isTTY) process.stderr.write(`\r${ESC}[K`);
  }
}
