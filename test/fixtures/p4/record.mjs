// Run once on d735b58. Never regenerate to accommodate an implementation change.
import { writeFileSync } from 'node:fs';
import { goldenSamples } from './golden.js';
if (!process.env.NODE_TEST_CONTEXT) writeFileSync(new URL('./premise2.json', import.meta.url), JSON.stringify(goldenSamples(), null, 1) + '\n');
import { clientSamples } from './clients.js';
if (!process.env.NODE_TEST_CONTEXT) writeFileSync(new URL('./clients.json', import.meta.url), JSON.stringify(await clientSamples(), null, 1) + '\n');
