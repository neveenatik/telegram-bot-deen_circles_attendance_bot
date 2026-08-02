import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_TYPES } from '../lib/sessionTypes.js';
import {
  DEFAULT_POINTS,
  pointsForAttendance,
} from '../lib/rewards/pointsConfig.js';

test('DEFAULT_POINTS covers every session type (weights stay in sync)', () => {
  for (const type of SESSION_TYPES) {
    assert.equal(
      typeof DEFAULT_POINTS.sessionTypeWeight[type],
      'number',
      `missing weight for session type ${type}`,
    );
  }
  // No stray weights for types that no longer exist.
  for (const type of Object.keys(DEFAULT_POINTS.sessionTypeWeight)) {
    assert.ok(SESSION_TYPES.includes(type), `unknown session type weight ${type}`);
  }
});

test('homeworkSubmitted rewards submission only', () => {
  assert.equal(DEFAULT_POINTS.homeworkSubmitted, 10);
});

test('pointsForAttendance weights main above training above recitation', () => {
  // main is the core commitment and carries the highest weight.
  assert.equal(pointsForAttendance('present', 'main'), 15);
  assert.equal(pointsForAttendance('present', 'training'), 12);
  // recitation-family lists (incl. تصحيح التلاوة and the open list) share baseline.
  assert.equal(pointsForAttendance('present', 'personalRecitation'), 10);
  assert.equal(pointsForAttendance('present', 'groupRecitation'), 10);
  assert.equal(pointsForAttendance('present', 'registeredSecondary'), 10);
  assert.equal(pointsForAttendance('present', 'open'), 10);
  assert.ok(
    pointsForAttendance('present', 'main') >
      pointsForAttendance('present', 'training'),
  );
  assert.ok(
    pointsForAttendance('present', 'training') >
      pointsForAttendance('present', 'personalRecitation'),
  );
});

test('pointsForAttendance is 0 for null/absent status', () => {
  assert.equal(pointsForAttendance(null, 'main'), 0);
  assert.equal(pointsForAttendance(undefined, 'training'), 0);
  assert.equal(pointsForAttendance('absent', 'main'), 0);
});
