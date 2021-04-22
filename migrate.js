#!/usr/bin/env node
const { Command } = require('commander');
const { spawnSync } = require('child_process');
const superagent = require('superagent');

const fuseProfiles = {};
function getToken(profileName) {
  try {
    const token = spawnSync('fuse', ['token', '-o', 'raw', '-p', profileName]).stdout.toString().trim();
    const profile = JSON.parse(spawnSync('fuse', ['profile', 'get', profileName, '-o', 'json']).stdout.toString());
    const timer = setTimeout(() => getToken(profileName), 1 * 60 * 60 * 1000); // update every hour, if the process is taking a long time.
    return (fuseProfiles[profileName] = { token, profile, timer });
  } catch (c) {
    console.log(`error: make sure your \`fuse profile get ${profileName} -o json\` returns the current fuse profile.`);
    process.exit(-1);
  }
}

// Get a list of functions matching the criteria
async function listFunctions(profileName, subscriptionId, options) {
  const fuseProfile = fuseProfiles[profileName].profile;
  const fuseToken = fuseProfiles[profileName].token;

  let items = [];
  let next;
  do {
    const url =
      fuseProfile.baseUrl +
      `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/function?${
        next ? `next=${next}&` : ''
      }${options.criteria.map((c) => `search=${c}`).join('&')}`;

    const response = await superagent.get(url).set({ Authorization: 'Bearer ' + fuseToken });
    next = response.body.next;
    items = items.concat(response.body.items);
  } while (next);

  console.log(`Identified ${items.length} matching functions...`);
  return items;
}

// Retrieve the specified function
async function getFunction(profileName, subscriptionId, boundaryId, functionId) {
  const fuseProfile = fuseProfiles[profileName].profile;
  const fuseToken = fuseProfiles[profileName].token;

  const url =
    fuseProfile.baseUrl +
    `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/boundary/${boundaryId}/function/${functionId}`;
  const response = await superagent.get(url).set({ Authorization: 'Bearer ' + fuseToken });

  return response.body;
}

// Recreate the function with the specified body
async function putFunction(profileName, subscriptionId, boundaryId, functionId, body, options) {
  const fuseProfile = fuseProfiles[profileName].profile;
  const fuseToken = fuseProfiles[profileName].token;

  const url =
    fuseProfile.baseUrl +
    `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/boundary/${boundaryId}/function/${functionId}`;
  const response = await superagent
    .put(url)
    .set({ Authorization: 'Bearer ' + fuseToken })
    .send(body);

  if (response.status == 200) {
    return;
  }

  if (response.status == 201) {
    await waitForBuild(profileName, response.body, 10, 5000, options);
  }
}

const waitForBuild = async (profileName, build, count, delay, options) => {
  const totalWait = count * delay;
  const fuseProfile = fuseProfiles[profileName].profile;
  const fuseToken = fuseProfiles[profileName].token;

  const url = `${fuseProfile.baseUrl}/v1/account/${fuseProfile.account}/subscription/${build.subscriptionId}/boundary/${build.boundaryId}/function/${build.functionId}/build/${build.buildId}`;

  while (true) {
    if (options.verbose) {
      console.log(
        `... waiting for build of /account/${fuseProfile.account}/subscription/${build.subscriptionId}/boundary/${build.boundaryId}/function/${build.functionId} ...`
      );
    }
    const response = await superagent.get(url).set({ Authorization: 'Bearer ' + fuseToken });

    if (response.status !== 201) {
      return;
    }

    if (count <= 0) {
      const error = new Error();
      error.status = 400;
      error.response = { body: { message: `Build did not complete within ${totalWait} ms` } };
      throw error;
    }

    count--;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

const commandMigrate = (program) => {
  program
    .command('migrate <sourceProfile> <destProfile>')
    .description('Migrate functions from one subscription to another.')
    .option('-c, --criteria <criteria...>', 'An alternate search criteria to use when finding derived functions')
    .option('-s, --sourceSubscription <sourceSubscriptionId>', 'Replace the subscription encoded in the sourceProfile')
    .option('-d, --destSubscription <destSubscriptionId>', 'Replace the subscription encoded in the destProfile')
    .option('-n, --dry-run', 'Perform no action, just report what would occur')
    .option('-v, --verbose', 'Log each function as it gets processed')
    .option('-w, --workers <workers>', 'Number of workers to run in parallel to update functions (default: 10)', 10)
    .action(async (sourceProfile, destProfile, cmdObj) => {
      const source = getToken(sourceProfile);
      const dest = getToken(destProfile);

      const sourceSubscriptionId = cmdObj.sourceSubscriptionId || source.profile.subscription;
      const destSubscriptionId = cmdObj.destSubscriptionId || dest.profile.subscription;
      cmdObj.criteria = cmdObj.criteria || [];

      const sourceFunctions = await listFunctions(sourceProfile, sourceSubscriptionId, cmdObj);
      const functionCount = sourceFunctions.length;

      if (sourceFunctions.length == 0) {
        console.log('No functions found');
        return;
      }

      // Update the children, n workers at a time.
      const workers = [];
      const failedFunctions = [];
      for (let n = 0; n < (cmdObj.dryRun ? 1 : cmdObj.workers); n++) {
        workers.push(
          (async () => {
            while (sourceFunctions.length > 0) {
              const item = sourceFunctions.pop();
              if (cmdObj.dryRun || cmdObj.verbose) {
                console.log(
                  `<<<< ${source.profile.account}/${sourceSubscriptionId}/${item.boundaryId}/${item.functionId}`
                );
              }
              const func = await getFunction(
                sourceProfile,
                sourceSubscriptionId,
                item.boundaryId,
                item.functionId,
                cmdObj
              );

              // Touch-up by removing some extraneous artifacts.
              delete func.subscriptionId;
              delete func.accountId;

              if (!cmdObj.dryRun) {
                try {
                  await putFunction(destProfile, destSubscriptionId, item.boundaryId, item.functionId, func, cmdObj);
                } catch (e) {
                  failedFunctions.push(item);
                  console.log(
                    `FAIL ${e.status} ${dest.profile.account}/${destSubscriptionId}/${item.boundaryId}/${item.functionId} ${e.response.body.message}`
                  );
                }
              }

              if (cmdObj.dryRun || cmdObj.verbose) {
                console.log(`>>>> ${dest.profile.account}/${destSubscriptionId}/${item.boundaryId}/${item.functionId}`);
              }
            }
          })()
        );
      }

      await Promise.all(workers);

      console.log(`STATUS: ${failedFunctions.length} failed out of ${functionCount} total functions.`);
      if (failedFunctions.length > 0) {
        failedFunctions.forEach((item) => {
          console.log(
            `  ${JSON.stringify({
              subscriptionId: sourceSubscriptionId,
              boundaryId: item.boundaryId,
              functionId: item.functionId,
            })}`
          );
        });
      }

      clearTimeout(source.timer);
      clearTimeout(dest.timer);
    });
};

module.exports = commandMigrate;
