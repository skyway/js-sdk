#!/usr/bin/env zx
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

const pkg = require('../package.json');
import { appendLicenses, createLicenses } from './license.mjs';

const dist = 'dist';

await $`rm -rf ${dist}`;
await $`mkdir ${dist}`;

await $`pnpm run compile`;

await $`esbuild src/index.ts --bundle --inject:./bundler/shims/process.js --format=esm --target=es6 --outfile=${dist}/index.mjs`;

const licenses = await createLicenses(pkg);
await appendLicenses(`${dist}/index.mjs`, licenses);
