'use client';

import { useState, useCallback, createContext, useContext } from 'react';
import { createContext as createCtx } from 'react';

export interface Command {
  id: string;
  label: string;
  group: string;
  href?: string;
  action?: () => void;
}

const DEFAULT_COMMANDS: Command[] = [
  { id: 'nav-overview', label: 'Go to Overview', group: 'Pages', href: '/' },
  { id: 'nav-rate-limits', label: 'Go to Rate Limits', group: 'Pages', href: '/rate-limits' },
  { id: 'nav-projects', label: 'Go to Projects', group: 'Pages', href: '/projects' },
  { id: 'nav-sessions', label: 'Go to Sessions', group: 'Pages', href: '/sessions' },
  { id: 'nav-activity', label: 'Go to Activity & Costs', group: 'Pages', href: '/activity' },
  { id: 'nav-tools', label: 'Go to Tools', group: 'Pages', href: '/tools' },
  { id: 'nav-agents', label: 'Go to Agents', group: 'Pages', href: '/agents' },
  { id: 'nav-plans', label: 'Go to Plans', group: 'Pages', href: '/plans' },
  { id: 'nav-settings', label: 'Go to Settings', group: 'Pages', href: '/settings' },
];

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  commands: Command[];
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  registerCommand: (cmd: Command) => void;
  unregisterCommand: (id: string) => void;
}

// Simple module-level singleton for cross-component state without zustand
type Listener = () => void;

let _isOpen = false;
let _query = '';
let _commands: Command[] = DEFAULT_COMMANDS;
const _listeners = new Set<Listener>();

let _snapshot: CommandPaletteState | null = null;

function notify() {
  _snapshot = null;
  _listeners.forEach((l) => l());
}

export const commandPaletteActions = {
  open() {
    _isOpen = true;
    _query = '';
    notify();
  },
  close() {
    _isOpen = false;
    _query = '';
    notify();
  },
  setQuery(q: string) {
    _query = q;
    notify();
  },
  registerCommand(cmd: Command) {
    _commands = [..._commands.filter((c) => c.id !== cmd.id), cmd];
    notify();
  },
  unregisterCommand(id: string) {
    _commands = _commands.filter((c) => c.id !== id);
    notify();
  },
  subscribe(listener: Listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },
  getSnapshot(): CommandPaletteState {
    if (!_snapshot) {
      _snapshot = {
        isOpen: _isOpen,
        query: _query,
        commands: _commands,
        open: commandPaletteActions.open,
        close: commandPaletteActions.close,
        setQuery: commandPaletteActions.setQuery,
        registerCommand: commandPaletteActions.registerCommand,
        unregisterCommand: commandPaletteActions.unregisterCommand,
      };
    }
    return _snapshot;
  },
};

import { useSyncExternalStore } from 'react';

const SERVER_SNAPSHOT: CommandPaletteState = {
  isOpen: false,
  query: '',
  commands: DEFAULT_COMMANDS,
  open: () => {},
  close: () => {},
  setQuery: () => {},
  registerCommand: () => {},
  unregisterCommand: () => {},
};

export function useCommandPaletteStore(): CommandPaletteState {
  return useSyncExternalStore(
    commandPaletteActions.subscribe,
    commandPaletteActions.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
