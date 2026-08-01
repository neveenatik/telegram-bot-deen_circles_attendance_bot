import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerActions } from '../lib/handlers/actions/index.js';
import { registerCommands } from '../lib/handlers/commands/index.js';
import { makeStorage } from './mocks.js';

/**
 * A mock bot that records every registration the handler modules perform, so we
 * can assert the whole tree wires up without a live Telegraf instance.
 */
function makeBot() {
  const registrations = { action: [], command: [], on: [], hears: [], start: 0, help: 0 };
  return {
    telegram: {},
    action(pattern, fn) { registrations.action.push({ pattern, fn }); },
    command(name, fn) { registrations.command.push({ name, fn }); },
    on(evt, fn) { registrations.on.push({ evt, fn }); },
    hears(pattern, fn) { registrations.hears.push({ pattern, fn }); },
    start(fn) { registrations.start++; this._startFn = fn; },
    help(fn) { registrations.help++; this._helpFn = fn; },
    registrations,
  };
}

test('registerActions wires every action handler without throwing', () => {
  const bot = makeBot();
  registerActions(bot, makeStorage());

  // Every registered handler must be a function.
  for (const { fn } of bot.registrations.action) assert.equal(typeof fn, 'function');
  assert.ok(bot.registrations.action.length > 0, 'expected action handlers to be registered');
});

test('registerCommands wires every command handler without throwing', () => {
  const bot = makeBot();
  registerCommands(bot, makeStorage());

  for (const { fn } of bot.registrations.command) assert.equal(typeof fn, 'function');
  assert.ok(bot.registrations.command.length > 0, 'expected command handlers to be registered');
  assert.equal(bot.registrations.start, 1, 'expected bot.start to be registered once');
  assert.equal(bot.registrations.help, 1, 'expected bot.help to be registered once');
});
