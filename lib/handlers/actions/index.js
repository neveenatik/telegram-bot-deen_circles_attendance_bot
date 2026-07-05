import { register as registerMembers } from './members.js';
import { register as registerAttendance } from './attendance.js';
import { register as registerManage } from './manage.js';
import { register as registerCheckpoints } from './checkpoints.js';
import { register as registerConfirm } from './confirm.js';
import { register as registerText } from './text.js';
import { register as registerGroups } from './groups.js';
import { register as registerHistory } from './history.js';

export function registerActions(bot, storage) {
  registerMembers(bot, storage);
  registerAttendance(bot, storage);
  registerManage(bot, storage);
  registerCheckpoints(bot, storage);
  registerConfirm(bot, storage);
  registerGroups(bot, storage);
  registerHistory(bot, storage);
  registerText(bot, storage);
}
