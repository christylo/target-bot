import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { StoredState } from "./types.js";

export interface StateData {
  products: Record<string, StoredState>;
}

export class StateStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<StateData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as StateData;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { products: {} };
      }

      throw error;
    }
  }

  async write(data: StateData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
