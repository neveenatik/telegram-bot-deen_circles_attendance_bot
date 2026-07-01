import { register as registerInfo } from './info.js';
import { register as registerSortnames } from './sortnames.js';
import { register as registerStatus } from './status.js';
import { register as registerMembers } from './members.js';
import { register as registerStart } from './start.js';
import { register as registerStop } from './stop.js';
import { register as registerHistory } from './history.js';
import { register as registerTagstudents } from './tagstudents.js';

export function registerCommands(bot, storage) {
  registerInfo(bot, storage);
  registerSortnames(bot, storage);
  registerStatus(bot, storage);
  registerMembers(bot, storage);
  registerStart(bot, storage);
  registerStop(bot, storage);
  registerHistory(bot, storage);
  registerTagstudents(bot, storage);
}
