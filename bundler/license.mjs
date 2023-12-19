#!/usr/bin/env zx
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
import { appendFile, readFile, unlink } from 'fs/promises';
import https from 'https';

export async function createLicenses() {
  await $`npm i`;

  const deps = JSON.parse(
    (await $`npx license-checker --json --production`).stdout
  );

  let output = '';

  for (const [name, detail] of Object.entries(deps)) {
    const { path } = detail;

    let licenseFile =
      (await readFile(path + '/LICENSE').catch(() => '')).toString() ||
      (await readFile(path + '/license').catch(() => '')).toString() ||
      (await readFile(path + '/LICENSE.md').catch(() => '')).toString() ||
      (await readFile(path + '/license.md').catch(() => '')).toString();

    const [, , , user, repo] = (detail.repository ?? '').split('/');
    licenseFile = licenseFile || (await downloadLicenses(user, repo));

    const pkg = JSON.parse((await readFile(path + '/package.json')).toString());

    output += name;
    output += '\n\n';
    output += pkg.license ?? detail.licenses ?? 'unlicensed';
    output += '\n\n';
    output += detail.repository ?? detail.url ?? '';
    output += '\n\n';
    if (licenseFile) {
      output += licenseFile;
      output += '\n\n';
    } else {
      console.log('no license file', name);
    }
    output += '---';
    output += '\n\n';
  }

  await $`rm -rf node_modules`;
  await $`rm package-lock.json`;

  return output;
}

export async function appendLicenses(dist, licenses) {
  await appendFile(`${dist}`, '\n/*\n');
  await appendFile(`${dist}`, licenses);
  await appendFile(`${dist}`, '*/');
}

async function downloadLicenses(user, repo) {
  const filenames = ['LICENSE', 'LICENSE.md', 'license', 'license.md'];
  const branches = ['main', 'master'];
  let result = '';
  for (const filename of filenames) {
    for (const branch of branches) {
      result = await downloadFromGithub(user, repo, branch, filename).catch(
        () => ''
      );
      if (result) {
        break;
      }
    }
    if (result) {
      break;
    }
  }
  return result;
}

const downloadFromGithub = async (user, repo, branch, filename) => {
  const dist = Math.random().toString().slice(2) + '.temp';
  await new Promise((r) => {
    const file = fs.createWriteStream(dist);
    https.get(
      `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filename}`,
      (response) => {
        response.pipe(file);
      }
    );
    file.on('finish', r);
  });
  const text = (await readFile(dist)).toString();
  await unlink(dist);

  if (text === '404: Not Found') {
    throw {};
  }

  return text;
};
