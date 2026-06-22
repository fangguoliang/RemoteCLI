#!/usr/bin/env tsx
/**
 * Action Map Generator Script
 *
 * Scans Vue routes, Pinia stores, and well-known actions to generate
 * an actionMap.json file for voice interaction.
 *
 * Output: packages/server/src/voice/actionMap.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to project root
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_FILE = join(PROJECT_ROOT, 'packages/web/src/router/index.ts');
const STORES_DIR = join(PROJECT_ROOT, 'packages/web/src/stores');
const OUTPUT_FILE = join(PROJECT_ROOT, 'packages/server/src/voice/actionMap.json');

interface ActionDefinition {
  id: string;
  type: 'navigation' | 'terminal' | 'file' | 'voice' | 'auth' | 'settings';
  description: string;
  utterances?: string[];
  params?: Record<string, string>;
  handler?: string;
}

interface ActionMap {
  version: string;
  generatedAt: string;
  actions: ActionDefinition[];
}

/**
 * Parse Vue routes from router/index.ts
 */
function parseRoutes(filePath: string): ActionDefinition[] {
  const content = readFileSync(filePath, 'utf-8');

  // Extract route definitions
  const routePattern = /\{\s*path:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*component:[^}]+\}/g;
  const actions: ActionDefinition[] = [];

  let match;
  while ((match = routePattern.exec(content)) !== null) {
    const [, path, name] = match;

    // Skip redirect routes
    if (path === '/' && content.includes(`redirect:`)) {
      continue;
    }

    actions.push({
      id: `navigate:${name.toLowerCase()}`,
      type: 'navigation',
      description: `Navigate to ${name} page`,
      utterances: [
        `go to ${name.toLowerCase()}`,
        `open ${name.toLowerCase()}`,
        `show ${name.toLowerCase()}`,
      ],
      params: {
        route: path,
        name: name,
      },
      handler: 'router.push',
    });
  }

  return actions;
}

/**
 * Parse Pinia store files for actionable methods
 */
function parseStores(storesDir: string): ActionDefinition[] {
  const actions: ActionDefinition[] = [];

  // Read all store files
  const storeFiles = [
    'terminal.ts',
    'file.ts',
    'auth.ts',
    'settings.ts',
    'webViewer.ts',
    'fileShortcuts.ts',
  ];

  for (const file of storeFiles) {
    const filePath = join(storesDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const storeActions = extractStoreActions(content, file);
      actions.push(...storeActions);
    } catch {
      // Skip files that don't exist or can't be read
      continue;
    }
  }

  return actions;
}

/**
 * Extract actions from a single store file
 */
function extractStoreActions(content: string, fileName: string): ActionDefinition[] {
  const actions: ActionDefinition[] = [];
  const storeName = fileName.replace('.ts', '');

  // Define patterns for different types of actions based on store
  const patterns: Array<{ regex: RegExp; type: ActionDefinition['type']; prefix: string }> = [];

  switch (storeName) {
    case 'terminal':
      patterns.push(
        {
          regex: /function\s+(addTab|restoreTab|removeTab|setActiveTab)\s*\(/g,
          type: 'terminal',
          prefix: 'tab',
        },
        {
          regex: /function\s+(sendKeyToActive|focusActiveTab|scrollActiveTabToBottom|fitActiveTab)\s*\(/g,
          type: 'terminal',
          prefix: 'terminal',
        },
        {
          regex: /function\s+(captureCommand|saveShortcut|deleteShortcut)\s*\(/g,
          type: 'terminal',
          prefix: 'shortcut',
        },
        {
          regex: /function\s+(setTabCwd)\s*\(/g,
          type: 'terminal',
          prefix: 'cwd',
        }
      );
      break;

    case 'file':
      patterns.push(
        {
          regex: /function\s+(setPath|setEntries|setLoading|setError)\s*\(/g,
          type: 'file',
          prefix: 'file',
        },
        {
          regex: /function\s+(addTransfer|updateTransfer|removeTransfer|clearCompletedTransfers)\s*\(/g,
          type: 'file',
          prefix: 'transfer',
        },
        {
          regex: /function\s+(setViewerVisible|setViewerContent|clearViewer)\s*\(/g,
          type: 'file',
          prefix: 'viewer',
        }
      );
      break;

    case 'auth':
      patterns.push(
        {
          regex: /function\s+(login|logout|clearTokens|refresh|changePassword)\s*\(/g,
          type: 'auth',
          prefix: 'auth',
        }
      );
      break;

    case 'settings':
      patterns.push(
        {
          regex: /function\s+(updateSettings|resetSettings)\s*\(/g,
          type: 'settings',
          prefix: 'settings',
        }
      );
      break;

    case 'webViewer':
      patterns.push(
        {
          regex: /function\s+(setUrl|setVisible|setMinimized|setViewport|clear)\s*\(/g,
          type: 'navigation',
          prefix: 'webviewer',
        }
      );
      break;

    case 'fileShortcuts':
      patterns.push(
        {
          regex: /function\s+(saveShortcut|deleteShortcut|clearAll)\s*\(/g,
          type: 'file',
          prefix: 'fileshortcut',
        }
      );
      break;
  }

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const methodName = match[1];
      const actionId = `${pattern.prefix}:${methodName}`;

      // Generate utterances based on method name
      const utterances = generateUtterances(methodName, pattern.type);

      actions.push({
        id: actionId,
        type: pattern.type,
        description: `${storeName} store action: ${methodName}`,
        utterances,
        handler: `stores.${storeName}.${methodName}`,
      });
    }
  }

  return actions;
}

/**
 * Generate natural language utterances for a given action
 */
function generateUtterances(methodName: string, type: ActionDefinition['type']): string[] {
  const utterances: string[] = [];

  // Convert camelCase to readable format
  const readable = methodName
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();

  // Add basic utterances
  utterances.push(`${readable}`);

  // Add type-specific variations
  switch (type) {
    case 'terminal':
      if (methodName.includes('Tab')) {
        utterances.push(`manage tab`);
      }
      if (methodName.includes('sendKey')) {
        utterances.push(`send key`);
      }
      break;
    case 'file':
      utterances.push(`file operation`);
      break;
    case 'auth':
      if (methodName === 'login') {
        utterances.push('log in', 'sign in');
      }
      if (methodName === 'clearTokens') {
        utterances.push('log out', 'sign out');
      }
      break;
  }

  return [...new Set(utterances)]; // Remove duplicates
}

/**
 * Add well-known manual actions that aren't derived from code
 */
function getWellKnownActions(): ActionDefinition[] {
  return [
    {
      id: 'terminal:execute',
      type: 'terminal',
      description: 'Execute a command in the terminal',
      utterances: ['run command', 'execute', 'run'],
      params: {
        command: 'string',
      },
      handler: 'pty.execute',
    },
    {
      id: 'terminal:interrupt',
      type: 'terminal',
      description: 'Interrupt current terminal operation',
      utterances: ['stop', 'cancel', 'interrupt', 'ctrl+c'],
      handler: 'pty.interrupt',
    },
    {
      id: 'session:create',
      type: 'terminal',
      description: 'Create a new terminal session',
      utterances: ['new session', 'open terminal', 'create session'],
      handler: 'session.create',
    },
    {
      id: 'session:close',
      type: 'terminal',
      description: 'Close current terminal session',
      utterances: ['close session', 'exit terminal'],
      handler: 'session.close',
    },
    {
      id: 'voice:start-recording',
      type: 'voice',
      description: 'Start voice recording',
      utterances: ['start listening', 'begin recording'],
      handler: 'voice.start',
    },
    {
      id: 'voice:stop-recording',
      type: 'voice',
      description: 'Stop voice recording',
      utterances: ['stop listening', 'end recording'],
      handler: 'voice.stop',
    },
    {
      id: 'clipboard:copy',
      type: 'terminal',
      description: 'Copy selected text to clipboard',
      utterances: ['copy text', 'copy selection'],
      handler: 'clipboard.copy',
    },
    {
      id: 'clipboard:paste',
      type: 'terminal',
      description: 'Paste text from clipboard',
      utterances: ['paste text', 'paste'],
      handler: 'clipboard.paste',
    },
  ];
}

/**
 * Main function to generate the action map
 */
function generateActionMap(): ActionMap {
  console.log('Generating action map...');

  // Parse routes
  const navigationActions = parseRoutes(ROUTES_FILE);
  console.log(`Found ${navigationActions.length} navigation actions from routes`);

  // Parse stores
  const storeActions = parseStores(STORES_DIR);
  console.log(`Found ${storeActions.length} actions from stores`);

  // Get well-known actions
  const wellKnownActions = getWellKnownActions();
  console.log(`Adding ${wellKnownActions.length} well-known actions`);

  // Combine all actions
  const allActions = [...navigationActions, ...storeActions, ...wellKnownActions];

  // Create action map
  const actionMap: ActionMap = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    actions: allActions,
  };

  return actionMap;
}

/**
 * Write action map to output file
 */
function writeActionMap(actionMap: ActionMap, outputPath: string): void {
  try {
    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });

    // Write JSON with pretty formatting
    const json = JSON.stringify(actionMap, null, 2);
    writeFileSync(outputPath, json, 'utf-8');

    console.log(`\nAction map written to: ${outputPath}`);
    console.log(`Total actions: ${actionMap.actions.length}`);
  } catch (error) {
    console.error('Error writing action map:', error);
    process.exit(1);
  }
}

// Run the generator
const main = () => {
  const actionMap = generateActionMap();
  writeActionMap(actionMap, OUTPUT_FILE);
};

main();
