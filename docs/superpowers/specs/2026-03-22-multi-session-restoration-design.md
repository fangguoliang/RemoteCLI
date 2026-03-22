# Multi-Session Restoration Design

**Date**: 2026-03-22
**Status**: Draft

## Problem Statement

Currently, after page refresh or re-login, only ONE active terminal session is restored. Users who have multiple active terminal sessions lose all but the most recent one. The requirement is to restore ALL active sessions that existed before refresh/login.

## Current Behavior

1. **Page refresh**: `sessionStorage` stores all tabs, but `getLastActiveTab()` returns only the active tab
2. **New login**: `localStorage` history stores recent tabs, but `getLastHistoryTab()` returns only the most recent one

## Proposed Solution

Modify the restoration logic to restore ALL tabs instead of just one.

## Changes

### 1. terminal.ts - Add new functions

Add three new functions to support multi-session restoration:

```typescript
// Get all session tabs for multi-session restoration (page refresh)
function getAllSessionTabs(): Tab[] {
  const session = loadSessionData();
  return session?.tabs || [];
}

// Get all history tabs for multi-session restoration (login)
function getAllHistoryTabsForRestore(): Tab[] {
  return historyTabs.value;
}

// Get the stored active tab ID (for preserving active tab after restoration)
function getStoredActiveTabId(): string | null {
  const session = loadSessionData();
  return session?.activeTabId || null;
}
```

Export these functions in the store's return statement (add to the return object around line 437-468).

### 2. TerminalView.vue - Modify restoreLastSession()

Replace the current single-tab restoration with multi-tab restoration:

```typescript
function restoreLastSession() {
  // Priority: 1) sessionStorage (page refresh), 2) localStorage history (login)
  let tabsToRestore = terminalStore.getAllSessionTabs();
  let activeIdToRestore: string | null = null;

  if (tabsToRestore.length === 0) {
    tabsToRestore = terminalStore.getAllHistoryTabsForRestore();
  } else {
    // Get the active tab ID from sessionStorage (only for page refresh scenario)
    activeIdToRestore = terminalStore.getStoredActiveTabId();
  }

  if (tabsToRestore.length === 0) return;

  // Restore all tabs
  for (const tab of tabsToRestore) {
    terminalStore.restoreTab(tab);
  }

  // Restore correct active tab (the last restoreTab() sets it to that tab)
  if (activeIdToRestore && tabsToRestore.some(t => t.id === activeIdToRestore)) {
    terminalStore.setActiveTab(activeIdToRestore);
  }
}
```

### 3. TerminalTab.vue - No changes needed

The existing implementation already handles offline agents:
- Shows "connecting" → "disconnected" status
- `session:resumed` failure triggers new session creation when agent comes online

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Agent offline | Tab is created, shows "disconnected" state, will connect when agent comes online |
| Mixed agent status (some online, some offline) | All tabs restored; online agents connect immediately, offline agents show "disconnected" |
| Session expired on server | `session:resumed` fails, new session is created automatically |
| Multiple tabs, some with same agent | All tabs restored independently |
| No previous sessions | Empty state shown, no restoration |
| MAX_HISTORY reached (10 tabs) | All 10 tabs restored on login; user can close unwanted tabs |

**Design Decision: Offline Agent Handling**

User confirmed: When an agent is offline, the tab should still be restored and show "disconnected" state. This allows the user to see their session history and have the tab auto-connect when the agent comes back online.

## Testing Checklist

- [ ] Refresh page with 2+ active sessions → all sessions restored
- [ ] Login with history of 2+ sessions → all sessions restored
- [ ] Refresh with offline agent → tab created in disconnected state
- [ ] Mixed agent status (online + offline) → all tabs restored with correct states
- [ ] Resume fails (session expired) → new session created
- [ ] Active tab is preserved after restoration
- [ ] Login with 10 history tabs → all 10 tabs restored (MAX_HISTORY limit)

## Implementation Notes

- The `activeTabId` is explicitly restored from sessionStorage after all tabs are restored
- `restoreTab()` sets `activeTabId` to each restored tab, so we must call `setActiveTab()` at the end
- `restoreTab()` already checks for duplicate tabs by `sessionId` (line 216-220), preventing duplicates if called multiple times
- History tabs are kept in localStorage (max 10), providing reasonable limit for restoration
- The current behavior clears session if agent is offline (lines 244-247 in TerminalView.vue) - this will be removed since we now restore all tabs regardless of agent status