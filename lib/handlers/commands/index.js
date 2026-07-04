import { register as registerInfo } from './info.js';
import { register as registerSortnames } from './sortnames.js';
import { register as registerStatus } from './status.js';
import { register as registerMembers } from './members.js';
import { register as registerStart } from './start.js';
import { register as registerCheckpoints } from './checkpoints.js';
import { register as registerStop } from './stop.js';
import { register as registerHistory } from './history.js';
import { register as registerTagstudents } from './tagstudents.js';
import { register as registerTeachers } from './teachers.js';
import { register as registerFeedback } from './feedback.js';
import { register as registerGroups } from './groups.js';

export function registerCommands(bot, storage) {
  registerInfo(bot, storage);
  registerSortnames(bot, storage);
  registerStatus(bot, storage);
  registerMembers(bot, storage);
  registerStart(bot, storage);
  registerCheckpoints(bot, storage);
  registerStop(bot, storage);
  registerHistory(bot, storage);
  registerTagstudents(bot, storage);
  registerTeachers(bot, storage);
  registerGroups(bot, storage);
  registerFeedback(bot);
}
