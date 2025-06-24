#!/usr/bin/env zx
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
import { appendFile, readFile, unlink } from 'fs/promises';
import https from 'https';

const LICENSE_POLICY = {
  allow: ["MIT", "ISC", "BSD"],
  deny:  ["GPL", "Apache"]
}; 

export async function createLicenses(pkg) {
  let output = '';

  const licenseInfo = (await $`pnpm --silent --filter=${pkg.name} license`)
    .stdout;

  const deps = JSON.parse(licenseInfo);

  for (const [, details] of Object.entries(deps)) {
    for (const detail of details) {
      const { name, versions, paths, license, homepage } = detail;
      for (const [i, version] of versions.entries()) {
        const path = paths[i];
        const pkg = JSON.parse(
          (await readFile(path + '/package.json')).toString()
        );
        const repoUrl = pkg.repository ? fmtRepoUrl(pkg.repository) : '';
        const [, , , user, repo] = (repoUrl ?? '').split('/');
        const licenseText = await getLicenseText({ path, user, repo, version });
        const licenseLevel = pkg.license ?? license ?? 'unlicensed'

        if (isRestrictedLicense(licenseLevel)) {
          throw new Error(
            `License of ${name} is Restricted (${licenseLevel}). Please use a different package.`
          );
        }

        output += fmtLicenseText({
          name,
          version,
          license: licenseLevel,
          url: repoUrl ?? homepage ?? pkg.url ?? '',
          licenseText,
        });
      }
    }
  }

  return output;
}

export async function appendLicenses(dist, licenses) {
  await appendFile(`${dist}`, '\n/*\n');
  await appendFile(`${dist}`, licenses);
  await appendFile(`${dist}`, '*/');
}

export async function getLicenseText({ path, user, repo, version }) {
  let licenseText =
    (await readFile(path + '/LICENSE').catch(() => '')).toString() ||
    (await readFile(path + '/license').catch(() => '')).toString() ||
    (await readFile(path + '/LICENSE.md').catch(() => '')).toString() ||
    (await readFile(path + '/license.md').catch(() => '')).toString();

  licenseText =
    licenseText || (user && repo && (await downloadLicenses(user, repo, version)));

  return licenseText;
}

// cf. https://github.com/davglass/license-checker/blob/de6e9a42513aa38a58efc6b202ee5281ed61f486/lib/index.js#L60
function fmtRepoUrl(repo) {
  if (typeof repo === 'string') {
    return `https://github.com/${repo}`;
  }

  if (typeof repo.url === 'string') {
    let url = repo.url;
    url = url.replace('git+ssh://git@', 'git://');
    url = url.replace('git+https://github.com', 'https://github.com');
    url = url.replace('git://github.com', 'https://github.com');
    url = url.replace('git@github.com:', 'https://github.com/');
    url = url.replace(/\.git$/, '');
    if (!url.startsWith('https://github.com')) {
      // https://github.com/clux/sdp-transform/blob/649ed1279b78a577e6944df2f675e8a285da5dd7/package.json#L8
      url = 'https://github.com/' + url;
    }
    return url;
  }

  return '';
}

function fmtLicenseText({
  name,
  version,
  license = 'unlicensed',
  url = '',
  licenseText,
}) {
  let output = `${name}@${version}`;
  output += '\n\n';
  output += license;
  output += '\n\n';
  output += url;
  output += '\n\n';
  if (licenseText) {
    output += licenseText;
    output += '\n\n';
  } else {
    console.log('no license file', name);
  }
  output += '---';
  output += '\n\n';
  return output;
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