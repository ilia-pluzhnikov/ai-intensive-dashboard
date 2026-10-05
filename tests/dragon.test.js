const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTarget, shotDelay, aimAngle, buildRig } = require('../js/dragon.js');

const field = [
  { id: 'leader', x: 900, state: 'fresh' },
  { id: 'mid', x: 500, state: 'fresh' },
  { id: 'slow', x: 300, state: 'stressed' },
  { id: 'caught', x: 100, state: 'bitten' },
];

test('pickTarget: nearest student ahead of the eye', () => {
  assert.equal(pickTarget(field, 250).id, 'slow');
});

test('pickTarget: a student exactly at the eye counts as ahead', () => {
  assert.equal(pickTarget(field, 300).id, 'slow');
});

test('pickTarget: nobody ahead → nearest one behind', () => {
  assert.equal(pickTarget(field, 950).id, 'leader');
});

test('pickTarget: dropped and finished students are never targets', () => {
  const c = [
    { id: 'dead', x: 320, state: 'dropped' },
    { id: 'done', x: 340, state: 'victory' },
    { id: 'prey', x: 700, state: 'fresh' },
  ];
  assert.equal(pickTarget(c, 300).id, 'prey');
});

test('pickTarget: nobody to shoot → null', () => {
  assert.equal(pickTarget([], 300), null);
  assert.equal(pickTarget([{ x: 400, state: 'dropped' }, { x: 500, state: 'victory' }], 300), null);
});

test('shotDelay: calm field → 7–11 s', () => {
  assert.equal(shotDelay(['fresh', 'victory'], () => 0), 7000);
  assert.equal(shotDelay(['fresh'], () => 1), 11000);
});

test('shotDelay: anyone stressed or bitten → 4–7 s', () => {
  assert.equal(shotDelay(['fresh', 'stressed'], () => 0), 4000);
  assert.equal(shotDelay(['bitten'], () => 1), 7000);
});

test('shotDelay: dropped students do not raise the alarm', () => {
  assert.equal(shotDelay(['dropped', 'fresh'], () => 0), 7000);
});

test('shotDelay: empty field still yields a calm delay', () => {
  assert.equal(shotDelay([], () => 0.5), 9000);
});

test('aimAngle: straight ahead → 0', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: 0 }), 0);
});

test('aimAngle: slightly up → that angle (negative = up)', () => {
  assert.ok(Math.abs(aimAngle({ x: 0, y: 0 }, { x: 100, y: -10 }) - -5.71) < 0.01);
});

test('aimAngle: steep up is clamped to 14° up', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: -300 }), -14);
});

test('aimAngle: below is clamped to 6° down', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: 100 }), 6);
});

test('aimAngle: target behind and above never flips the head', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: -100, y: -50 }), -14);
});

test('buildRig: parts paint in the layer order of tools/dragon/cut.py', () => {
  const order = [...buildRig().matchAll(/class="part (\w+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['tail', 'body', 'mouth', 'jaw', 'head', 'hand']);
});

test('buildRig: has the neck joint it aims with and the eye the laser leaves', () => {
  const html = buildRig();
  assert.match(html, /class="head-aim"/);
  assert.match(html, /class="eye"/);
});
