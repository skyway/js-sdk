#!/usr/bin/env zx
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
import { appendFile, readFile, unlink } from 'fs/promises';
import https from 'https';

const LICENSE_POLICY = {
  allow: ["MIT", "ISC", "BSD"],
  deny:  ["GPL", "Apache"]
}; 

export async function createLicenses() {
  await $`npm i --ws false`; // ignore npm's workspace to create node_modules; license-checker needs to read node_modules.

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
    const version = getPackageVersion(name);
    licenseFile = licenseFile || (await downloadLicenses(user, repo, version));

    const pkg = JSON.parse((await readFile(path + '/package.json')).toString());
    const license = pkg.license ?? detail.licenses ?? 'unlicensed';

    if(isRestrictedLicense(license)) {
      throw new Error(
        `License of ${name} is Restricted (${license}). Please use a different package.`
      );
    }

    output += name;
    output += '\n\n';
    output += license;
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

async function downloadLicenses(user, repo, version) {
  const filenames = ['LICENSE', 'LICENSE.md', 'license', 'license.md'];

  let result = '';
  for (const filename of filenames) {
    result = await downloadFromVersionBranch(user, repo, version, filename).catch(
      () => ''
    );
    if (result) {
      break;
    }
  }

  if (!result) {
    for (const filename of filenames) {
      result = await downloadFromDefaultBranch(user, repo, filename).catch(
        () => ''
      );
      if (result) {
        break;
      }
    }
  }
  return result;
}

const downloadFromVersionBranch = async (user, repo, version, filename) => {
  const prefixes = ["", "v"];
  let result = '';
  for (const prefix of prefixes) {
    const branch = prefix + version;
    result = await downloadFromGithub(user, repo, branch, filename).catch(
      () => ''
    );
    if (result) {
      break;
    }
  }
  return result;
}

const downloadFromDefaultBranch = async (user, repo, filename) => {
  const defaultBranches = ["main", "master"];
  let result = '';
  for (const branch of defaultBranches) {
    result = await downloadFromGithub(user, repo, branch, filename).catch(
      () => ''
    );
    if (result) {
      return result;
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

function getPackageVersion(name) {
  const match = name.match(/@([^@]+)$/);
  if (match) {
    return match[1];
  }
  return "";
}

function isRestrictedLicense(license) {
  if (!license) return true;

  for (const denied of LICENSE_POLICY.deny) {
    if (license.includes(denied)) {
      return true;
    }
  }

  for (const allowed of LICENSE_POLICY.allow) {
    if (license.includes(allowed)) {
      return false;
    }
  }

  return true;
}