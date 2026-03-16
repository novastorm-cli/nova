#!/usr/bin/env node

import { run } from '../src/index.js';

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
