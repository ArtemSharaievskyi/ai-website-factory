import { opendir } from "node:fs/promises";
import { opendirSync } from "node:fs";
import type { Dirent } from "node:fs";

export async function readDirectory(directory: string): Promise<Dirent[]> {
  const handle = await opendir(/* turbopackIgnore: true */ directory);
  const entries: Dirent[] = [];
  for await (const entry of handle) entries.push(entry);
  return entries;
}

export function readDirectorySync(directory: string): Dirent[] {
  const handle = opendirSync(/* turbopackIgnore: true */ directory);
  try {
    const entries: Dirent[] = [];
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) entries.push(entry);
    return entries;
  } finally {
    handle.closeSync();
  }
}

export async function readDirectoryTree(directory: string): Promise<string[]> {
  const names: string[] = [];
  const walk = async (current: string, relative: string) => {
    for (const entry of await readDirectory(/* turbopackIgnore: true */ current)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(/* turbopackIgnore: true */ `${current}/${entry.name}`, name);
      else names.push(name);
    }
  };
  await walk(directory, "");
  return names;
}
