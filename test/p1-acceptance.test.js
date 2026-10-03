import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAcceptance } from './fixtures/p1/acceptance.mjs';
test('P1 acceptance: new local world, scripted mock two days, rebody, restart, HTTP and replay', async () => {
  const env=await prepareAcceptance();
  try {assert.equal(env.report.days,2);assert.ok(Object.values(env.report.checks).every(Boolean));}
  finally {await env.cleanup();}
});
