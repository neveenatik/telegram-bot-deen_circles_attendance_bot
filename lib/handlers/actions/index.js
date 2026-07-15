import { register as registerMembers } from './members.js';
import { register as registerAttendance } from './attendance.js';
import { register as registerManage } from './manage.js';
import { register as registerConfirm } from './confirm.js';
import { register as registerText } from './text.js';
import { register as registerGroups } from './groups.js';
import { register as registerHistory } from './history.js';
import { register as registerOffline } from './offline.js';
import { register as registerHub } from './hub.js';
import { register as registerMaterials } from './materials.js';
import { register as registerHomework } from './homework.js';
import { register as registerStudentHomework } from './studentHomework.js';
import { register as registerTimetable } from './timetable.js';

export function registerActions(bot, storage) {
  registerMembers(bot, storage);
  registerAttendance(bot, storage);
  registerManage(bot, storage);
  registerConfirm(bot, storage);
  registerGroups(bot, storage);
  registerHistory(bot, storage);
  registerOffline(bot, storage);
  registerHub(bot, storage);
  registerMaterials(bot, storage);
  registerHomework(bot, storage);
  registerStudentHomework(bot, storage);
  registerTimetable(bot, storage);
  registerText(bot, storage);
}
