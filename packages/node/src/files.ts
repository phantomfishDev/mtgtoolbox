import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  emptyLedger,
  emptyConfig,
  parsePrinted,
  parseConfig,
  type PrintedLedger,
  type Config,
} from '@mtgproxy/core';
import { printedPath, configPath } from './paths.js';

/**
 * Reading and writing the two files a user owns.
 *
 * The printed ledger cannot be regenerated from anything else, so writes go through
 * a temp file and a rename, and the previous contents are kept as `.bak`. A
 * crash mid-write leaves either the old file or the new one, never a truncated
 * mixture.
 */

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  // Keep the previous version before replacing it.
  try {
    await copyFile(path, `${path}.bak`);
  } catch {
    // No existing file to back up.
  }

  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, 'utf8');
  await rename(temporary, path);
}

export interface LoadResult<T> {
  data: T;
  /** False when the file did not exist and a default was returned. */
  existed: boolean;
  path: string;
}

export async function loadPrinted(override?: string): Promise<LoadResult<PrintedLedger>> {
  const path = printedPath(override);
  try {
    const raw = await readFile(path, 'utf8');
    return { data: parsePrinted(JSON.parse(raw)), existed: true, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { data: emptyLedger(), existed: false, path };
    }
    if (error instanceof SyntaxError) {
      throw new Error(`printed ledger at ${path} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export async function savePrinted(ledger: PrintedLedger, override?: string): Promise<string> {
  const path = printedPath(override);
  await writeJsonAtomic(path, ledger);
  return path;
}

export async function loadConfig(override?: string): Promise<LoadResult<Config>> {
  const path = configPath(override);
  try {
    const raw = await readFile(path, 'utf8');
    return { data: parseConfig(JSON.parse(raw)), existed: true, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { data: emptyConfig(), existed: false, path };
    }
    if (error instanceof SyntaxError) {
      throw new Error(`config file at ${path} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export async function saveConfig(config: Config, override?: string): Promise<string> {
  const path = configPath(override);
  await writeJsonAtomic(path, config);
  return path;
}
