#!/usr/bin/env zx
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

import { appendLicenses, createLicenses } from '../../bundler/license.mjs';
const pkg = require('./package.json');

await fs.writeFile(
  './src/version.ts',
  `export const PACKAGE_VERSION = '${pkg.version}';\n`
);

const globalName = 'skyway_core';
const dist = 'dist';

await $`pnpm run compile`;

await $`cp -r ../../bundler/shims ./ `;

await $`esbuild src/index.ts --bundle --inject:./shims/process.js --format=esm --target=es6 --outfile=${dist}/index.mjs`;
await $`esbuild src/index.ts --bundle --inject:./shims/process.js --format=iife --global-name=${globalName} --target=es6 --outfile=${dist}/${globalName}-latest.js`;

const licenses = await createLicenses(pkg);
await appendLicenses(`${dist}/index.mjs`, licenses);
await appendLicenses(`${dist}/${globalName}-latest.js`, licenses);

await $`cp ${dist}/${globalName}-latest.js ${dist}/${globalName}-${pkg.version}.js`;

await $`rm -rf ./shims`;
