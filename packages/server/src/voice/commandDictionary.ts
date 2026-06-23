// packages/server/src/voice/commandDictionary.ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CommandEntry {
  keywords: string[];
  action_id: string;
  params: Record<string, unknown>;
}

export interface DictionaryMatch {
  action_id: string;
  params: Record<string, unknown>;
}

export class CommandDictionary {
  private commands: CommandEntry[] = [];

  load() {
    const configPath = join(__dirname, 'commands.json');
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      this.commands = data.commands || [];
    } catch {
      // commands.json is optional - use empty commands if not found
      this.commands = [];
    }
  }

  match(text: string): DictionaryMatch | null {
    const normalized = text.trim();

    // Exact match first
    for (const cmd of this.commands) {
      for (const keyword of cmd.keywords) {
        if (normalized === keyword) {
          return { action_id: cmd.action_id, params: cmd.params };
        }
      }
    }

    // Contains match (fuzzy)
    for (const cmd of this.commands) {
      for (const keyword of cmd.keywords) {
        if (normalized.includes(keyword)) {
          return { action_id: cmd.action_id, params: cmd.params };
        }
      }
    }

    return null;
  }
}
