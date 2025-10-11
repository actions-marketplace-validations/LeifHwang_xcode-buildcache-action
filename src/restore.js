import * as path from 'path';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as toolCache from '@actions/tool-cache';
import * as utils from './utils.js';

const { logger } = utils;

async function getLatestVersion() {
  try {
    const resp = await fetch('https://gitlab.com/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'allReleases',
        variables: {
          fullPath: 'bits-n-bites/buildcache',
          first: 1,
          sort: 'RELEASED_AT_DESC'
        },
        query:
          'query allReleases($fullPath: ID!, $first: Int, $last: Int, $before: String, $after: String, $sort: ReleaseSort) {\n  project(fullPath: $fullPath) {\n    id\n    releases(\n      first: $first\n      last: $last\n      before: $before\n      after: $after\n      sort: $sort\n    ) {\n      nodes {\n        ...Release\n        __typename\n      }\n      pageInfo {\n        startCursor\n        hasPreviousPage\n        hasNextPage\n        endCursor\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment Release on Release {\n  id\n  name\n  tagName\n  tagPath\n  descriptionHtml\n  releasedAt\n  createdAt\n  upcomingRelease\n  historicalRelease\n  assets {\n    count\n    sources {\n      nodes {\n        format\n        url\n        __typename\n      }\n      __typename\n    }\n    links {\n      nodes {\n        id\n        name\n        url\n        directAssetUrl\n        linkType\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  evidences {\n    nodes {\n      id\n      filepath\n      collectedAt\n      sha\n      __typename\n    }\n    __typename\n  }\n  links {\n    editUrl\n    selfUrl\n    openedIssuesUrl\n    closedIssuesUrl\n    openedMergeRequestsUrl\n    mergedMergeRequestsUrl\n    closedMergeRequestsUrl\n    __typename\n  }\n  commit {\n    id\n    sha\n    webUrl\n    title\n    __typename\n  }\n  author {\n    id\n    webUrl\n    avatarUrl\n    username\n    __typename\n  }\n  milestones {\n    nodes {\n      id\n      title\n      description\n      webPath\n      stats {\n        totalIssuesCount\n        closedIssuesCount\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}'
      })
    });
    const { data } = await resp.json();
    const latest = data.project.releases.nodes[0].tagName;

    logger.info(`got latest version: ${latest}`);

    return latest;
  } catch (error) {
    return undefined;
  }
}

async function download() {
  const filename = 'buildcache-macos.zip';
  let version = core.getInput('version');
  if (!version || version === 'latest') {
    version = await getLatestVersion();
  }

  if (!version) throw Error('version is undefined');

  const downloadUrl = `https://gitlab.com/bits-n-bites/buildcache/-/releases/${version}/downloads/${filename}`;
  logger.info(`download url: ${downloadUrl}`);

  const downloadPath = await toolCache.downloadTool(downloadUrl);
  logger.info(`download path: ${downloadPath}`);

  return downloadPath;
}

async function install(downloadPath) {
  const installDir = utils.getEnvVar('GITHUB_WORKSPACE', '');
  await io.mkdirP(installDir);

  const buildcacheFolder = await toolCache.extractZip(downloadPath, installDir);
  logger.info(`unpacked folder ${buildcacheFolder}`);

  // do symbolic links
  const buildcacheBinPath = path.join(buildcacheBinFolder, 'buildcache');
  const buildcacheBinFolder = path.resolve(buildcacheBinPath, 'bin');

  await exec.exec('ln', ['-s', buildcacheBinPath, path.join(buildcacheBinFolder, 'clang')]);
  await exec.exec('ln', ['-s', buildcacheBinPath, path.join(buildcacheBinFolder, 'clang++')]);

  core.addPath(buildcacheBinFolder);
}

async function restore() {
  const { getCacheDir, getCacheKeys } = utils;

  try {
    const cacheDir = await getCacheDir();
    const { withInput, unique } = getCacheKeys();

    const restoredWith = await cache.restoreCache([cacheDir], unique, [withInput]);
    if (restoredWith) {
      logger.info(`restored from cache key "${restoredWith}".`);
    } else {
      logger.warning(`no cache for key ${unique} or ${withInput} - cold cache or invalid key`);
    }
  } catch (e) {
    logger.error(`caching not working: ${e}`);
  }
}

async function run() {
  try {
    const downloadPath = await download();
    await install(downloadPath);

    await restore();

    await utils.printStats();
  } catch (e) {
    logger.error(`failure during restore: ${e}`);

    core.setFailed(e);
  }
}

run();
export default run;
