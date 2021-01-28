#!/usr/bin/env node
const { Command } = require('commander');
const { spawnSync } = require('child_process');
const superagent = require('superagent');
const jsdiff = require('diff');
const fs = require('fs');
const path = require('path');

let fuseToken, fuseProfile;

try {
  fuseToken = spawnSync('fuse', ['token', '-o', 'raw']).stdout.toString().trim();
  fuseProfile = JSON.parse(spawnSync('fuse', ['profile', 'get', '-o', 'json']).stdout.toString());
} catch (c) {
  console.log('ERROR: Make sure your `fuse profile get -o json` returns the current fuse profile.');
  process.exit(-1);
}

function normalizeScriptPath(script) {
  return path.resolve(script);
}

// Get a list of functions matching the criteria
async function listFunctions(subscriptionId, options) {
  if (options.funcCriteria) {
    return [
      {
        boundaryId: options.funcCriteria.split('/')[0],
        functionId: options.funcCriteria.split('/')[1],
        schedule: {},
        location: '',
      },
    ];
  }

  const url =
    fuseProfile.baseUrl +
    `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/function?${options.criteria
      .map((c) => `search=${c}`)
      .join('&')}`;
  const response = await superagent.get(url).set({ Authorization: 'Bearer ' + fuseToken });

  return response.body.items;
}

// Retrieve the specified function
async function getFunction(subscriptionId, boundaryId, functionId) {
  const url =
    fuseProfile.baseUrl +
    `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/boundary/${boundaryId}/function/${functionId}`;
  const response = await superagent.get(url).set({ Authorization: 'Bearer ' + fuseToken });

  return response.body;
}

// Recreate the function with the specified body
async function putFunction(subscriptionId, boundaryId, functionId, body) {
  const url =
    fuseProfile.baseUrl +
    `/v1/account/${fuseProfile.account}/subscription/${subscriptionId}/boundary/${boundaryId}/function/${functionId}`;
  const response = await superagent
    .put(url)
    .set({ Authorization: 'Bearer ' + fuseToken })
    .send(body);

  return response.body;
}

// Replace the files in a function with the files passed in from templateFiles
async function updateFiles(templateFiles, subscriptionId, templatePath, boundaryId, functionId, options) {
  let func = await getFunction(subscriptionId, boundaryId, functionId);

  const updatedFiles = [];
  for (const name in templateFiles) {
    if (options.force || func.nodejs.files[name] != templateFiles[name]) {
      updatedFiles.push(name);
    }
    func.nodejs.files[name] = templateFiles[name];
  }

  if (options.delete) {
    Object.keys(func.nodejs.files)
      .filter((fn) => Object.keys(templateFiles).indexOf(fn) == -1)
      .forEach((fn) => {
        delete func.nodejs.files[fn];
        updatedFiles.push(fn);
      });
  }

  if (options.scripts) {
    // Handle the catchall for fusebit.json,
    if (options.scripts['fusebit.json']) {
      func = options.scripts['fusebit.json'](func);
      if (!func) {
        throw new Error(
          `The script for 'fusebit.json' did not return a new function specification.  This is probably a bug.`
        );
      }

      updatedFiles.push('fusebit.json');
    }

    Object.keys(options.scripts).forEach((k) => {
      if (func.nodejs.files[k]) {
        func.nodejs.files[k] = JSON.stringify(options.scripts[k](JSON.parse(func.nodejs.files[k])), null, 2);
        updatedFiles.push(k);
      }
    });
  }

  if (updatedFiles.length == 0) {
    console.log(`${boundaryId}/${functionId} is up-to-date.`);
    return;
  }

  if (!options.dryRun) {
    await putFunction(subscriptionId, boundaryId, functionId, func);
  }

  console.log(`Updated ${boundaryId}/${functionId}: ${updatedFiles.join(', ')}`);
}

// Replace the files in a function with the files passed in from templateFiles
async function diffFiles(templateFiles, subscriptionId, templatePath, boundaryId, functionId, options) {
  let func = await getFunction(subscriptionId, boundaryId, functionId);
  let oldFunc;

  if (options.scripts) {
    // Easier than doing a deep copy of a json object
    oldFunc = await getFunction(subscriptionId, boundaryId, functionId);

    // Handle the catchall for fusebit.json,
    if (options.scripts['fusebit.json']) {
      func = options.scripts['fusebit.json'](func);
    }

    Object.keys(options.scripts).forEach((k) => {
      if (func.nodejs.files[k]) {
        func.nodejs.files[k] = JSON.stringify(options.scripts[k](JSON.parse(func.nodejs.files[k])), null, 2);
      }
    });
  }

  for (const name in templateFiles) {
    console.log(
      jsdiff.createTwoFilesPatch(
        `${options.path ? '' : subscriptionId + '/'}${templatePath}${name}`,
        `${subscriptionId}/${boundaryId}/${functionId}/${name}`,
        templateFiles[name],
        func.nodejs.files[name] || '',
        'Template',
        'Instance'
      )
    );
  }

  if (Object.keys(templateFiles).length == 0) {
    // Fall through when there's no template files, just script to modify the json files in a function.
    console.log(
      jsdiff.createTwoFilesPatch(
        `old/${subscriptionId}/${boundaryId}/${functionId}`,
        `new/${subscriptionId}/${boundaryId}/${functionId}`,
        JSON.stringify(oldFunc, null, 2),
        JSON.stringify(func, null, 2),
        'Template',
        'Instance'
      )
    );
  }
}

// Update all of the childen of the template
async function processTemplateFunctions(subscriptionId, action, options) {
  let templateFiles = {};
  let templatePath;

  if (options.path) {
    const pathRoot = path.resolve(path.join(options.path, options.include || ''));
    // Pull the files from the local filesystem
    const dirs = [pathRoot];
    while (dirs.length > 0) {
      // Read all the files in this directory
      const dir = dirs.pop();
      fs.readdirSync(dir).forEach((file) => {
        const fn = path.join(dir, file);
        if (fs.lstatSync(fn).isDirectory()) {
          // Walk this directory
          dirs.push(fn);
        } else {
          // Exclude .env and other similar files.
          if (file[0] != '.' && file !== 'fusebit.json') {
            templateFiles[fn.slice(pathRoot.length + 1)] = fs.readFileSync(fn, { encoding: 'utf8' });
          }
        }
      });
    }

    templatePath = path.join(options.path, options.include || '');
  } else if (options.template) {
    // Load the template function from remote
    const templateBoundary = options.template.split('/')[0];
    const templateId = options.template.split('/')[1];

    // Get the template
    const templateFunc = await getFunction(subscriptionId, templateBoundary, templateId);

    // If it's not supplied, do the default thing that makes sense and only look at files in the template/
    // subdirectory
    options.include = options.include || 'template/';

    // Identify the files to replace
    Object.keys(templateFunc.nodejs.files)
      .filter((f) => !options.include || f.startsWith(options.include))
      .forEach(
        (f) => (templateFiles[f.slice(options.include ? options.include.length : 0)] = templateFunc.nodejs.files[f])
      );

    templatePath = `${templateBoundary}/${templateId}/${options.include}`;

    options.criteria = options.criteria || `template.id=${templateId}`;
  } else if (!options.scripts) {
    throw new Error('Unknown source for function changes');
  }

  // Find all of it's children
  const funcs = await listFunctions(subscriptionId, options);

  if (funcs.length == 0) {
    console.log('No matching functions found');
    return;
  }

  // Update the children
  await Promise.all(
    funcs.map((f) => action(templateFiles, subscriptionId, templatePath, f.boundaryId, f.functionId, options))
  );
}

if (require.main === module) {
  const program = new Command();
  program.description(
    [
      'Update Examples:',
      "  Update all functions based on a template, removing old files that aren't present in the template:",
      '    $ fuse-tool update -s ${SUB} template-manager/sample-slack-addon -i template/ --delete',
      '',
      "  Update a specific function based on a template, removing old files that aren't present in the template:",
      '    $ fuse-tool update -s ${SUB} template-manager/sample-slack-addon -i template/ --delete -u someboundary/somefunction',
      '',
      "  Update a function based on a template on disk, removing old files that aren't present in the template:",
      '    $ fuse-tool update -s ${SUB} -p ./template-manager_sample-slack-addon -i template/ --delete',
      '',
      "  Update a template based on the files on disk, removing old files that aren't present in the template:",
      "    # NOTE - this is the same as doing a 'fuse function put -d'",
      '    $ fuse-tool update -s ${SUB} -p ./template-manager_sample-slack-addon -u template-manager/sample-slack-addon --delete',
      '',
      'Diff Examples:',
      '  Compare a template with one on disk:',
      '    $ fuse-tool diff -s ${SUB} -p ./template-manager_sample-slack-addon -u template-manager/sample-slack-addon',
      '',
      '  Compare the files in a template\'s "template/" directory with children, found through "template.id=id":',
      '    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/',
      '',
      '  Compare the files in a template\'s "template/" directory with children based on a search criteria:',
      '    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -c tags.type=slack',
      '',
      '  Compare the files in a template\'s "template/" directory with children based on multiple search criteria:',
      '    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -c tags.type=slack compute.timeout=30',
      '',
      '  Compare the files in a template\'s "template/" directory with a specific child:',
      '    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -u someboundary/somefunction',
      '',
      '  Compare the files in an on-disk template\'s "template/" directory with a specific child:',
      '    $ fuse-tool diff -s ${SUB} -p ./template-manager_sample-slack-addon -i template/ -u someboundary/somefunction',
    ].join('\n')
  );

  program
    .command('update [template]')
    .description(
      'Update all of the functions were created by the specified template with the files in "template/"\n' +
        `For example '$ fuse-tool update template-manager/sample-slack-addon -i template/`
    )
    .requiredOption('-s, --subscription <subscriptionId>', 'Subscription ID')
    .option('-c, --criteria <criteria...>', 'An alternate search criteria to use when finding derived functions')
    .option('-d, --delete', 'Delete files in the target function that are not present in the source')
    .option('-f, --force', 'Update the files, even if they have not changed')
    .option('-u, --function <boundary/id>', 'Look only at the function specified by this boundary/functionId')
    .option('-i, --include <path>', 'Select the files to update from the source')
    .option('-n, --dry-run', 'Perform no action, just report what would occur')
    .option('-p, --path <path>', 'Use the the template specified in [path] instead of <template>')
    .option(
      '--script <path>',
      [
        'Load the specified JavaScript file and use the functions declared as modifiers-of-last-resort for a function.',
        '',
        'Example:',
        '\t// Parse the entire function specification',
        '\texports["fusebit.json"] = (j) => { j.compute.memorySize = 256; return j; };',
        '\t// Parse a specific json file in the function',
        '\texports["package.json"] = (j) => { j.dependencies.superagent = "6.1.0"; return j; };',
      ].join('\n')
    )
    .action(async (template, cmdObj) => {
      if (cmdObj.subscription.length != 'sub-0000000000000000'.length) {
        console.log('Subscription is not in the right format');
        return process.exit(-1);
      }

      if (cmdObj.path && !cmdObj.criteria && !cmdObj.function) {
        console.log(
          'Criteria or function must be specified when using --path, for example: "-c template.id=sample-slack-addon"'
        );
        return process.exit(-1);
      }

      let scripts;
      if (cmdObj.script) {
        scripts = require(normalizeScriptPath(cmdObj.script));
      }

      if (!template && !cmdObj.path && !scripts) {
        console.log('At least one of [template], [--path], or [--script] must be specified');
        return process.exit(-1);
      }

      try {
        await processTemplateFunctions(cmdObj.subscription, updateFiles, {
          criteria: cmdObj.criteria,
          delete: cmdObj.delete,
          dryRun: cmdObj.dryRun,
          force: cmdObj.force,
          funcCriteria: cmdObj.function,
          path: cmdObj.path,
          template,
          scripts,
          include: cmdObj.include,
        });
      } catch (e) {
        console.log(`Error occurred:`, e);
        return process.exit(-1);
      }
    });

  program
    .command('diff [template]')
    .description(
      'Diff the files in the derived functions with the files in the template/ directory of the specified template.\n' +
        `For example '$ fuse-tool diff template-manager/sample-slack-addon'`
    )
    .requiredOption('-s, --subscription <subscriptionId>', 'Subscription ID')
    .option('-c, --criteria <criteria...>', 'An alternate search criteria to use when finding derived functions')
    .option('-u, --function <boundary/id>', 'Look only at the function specified by this boundary/functionId')
    .option('-i, --include <path>', 'Select the files to match from the source')
    .option('-p, --path <path>', 'Use the the files specified in [path] instead of <template>')
    .option(
      '--script <path>',
      [
        'Load the specified JavaScript file and use the functions declared as modifiers-of-last-resort for a function.',
        '',
        'Example:',
        '\t// Parse the entire function specification',
        '\texports["fusebit.json"] = (j) => { j.compute.memorySize = 256; return j; };',
        '\t// Parse a specific json file in the function',
        '\texports["package.json"] = (j) => { j.dependencies.superagent = "6.1.0"; return j; };',
      ].join('\n')
    )
    .action(async (template, cmdObj) => {
      if (cmdObj.subscription.length != 'sub-0000000000000000'.length) {
        console.log('Subscription is not in the right format');
        return process.exit(-1);
      }

      if (cmdObj.path && !cmdObj.criteria && !cmdObj.function) {
        console.log(
          'Criteria or function must be specified when using --path, for example: "-c template.id=sample-slack-addon"'
        );
        return process.exit(-1);
      }

      let scripts;
      if (cmdObj.script) {
        scripts = require(normalizeScriptPath(cmdObj.script));
      }

      if (!template && !cmdObj.path && !scripts) {
        console.log('At least one of [template], [--path], or [--script] must be specified');
        return process.exit(-1);
      }

      try {
        await processTemplateFunctions(cmdObj.subscription, diffFiles, {
          criteria: cmdObj.criteria || [],
          funcCriteria: cmdObj.function,
          path: cmdObj.path,
          include: cmdObj.include,
          template,
          scripts,
        });
      } catch (e) {
        console.log(`${e}`, e);
        return process.exit(-1);
      }
    });

  (async () => await program.parseAsync(process.argv))();
}
