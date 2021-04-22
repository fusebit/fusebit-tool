# Install

Run `npm pack && npm install -g ./fusebit-*.tgz` to install from this repository.

# Usage

Usage: fuse-tool [options] [command]

## Update Examples:
  Update all functions based on a template, removing old files that aren't present in the template:
  ```
    $ fuse-tool update -s ${SUB} template-manager/sample-slack-addon -i template/ --delete
  ```

  Update a specific function based on a template, removing old files that aren't present in the template:
  ```
    $ fuse-tool update -s ${SUB} template-manager/sample-slack-addon -i template/ --delete -u someboundary/somefunction
  ```

  Update a function based on a template on disk, removing old files that aren't present in the template:
  ```
    $ fuse-tool update -s ${SUB} -p ./template-manager_sample-slack-addon -i template/ --delete
  ```

  Update a template based on the files on disk, removing old files that aren't present in the template:
  ```
    # NOTE - this is the same as doing a 'fuse function put -d'
    $ fuse-tool update -s ${SUB} -p ./template-manager_sample-slack-addon -u template-manager/sample-slack-addon --delete
  ```

  Update a function, using a script to modify the function directly:
  ```
    $ cat modify.js
		exports["fusebit.json"] = (j) => {
			j.compute.memorySize = 256;
			return j;
		};
		exports["package.json"] = (j) => {
			j.dependencies.superagent = "6.1.0";
			return j;
		};
    $ fuse-tool update -s ${SUB} -u template-manager/sample-slack-addon --script modify.js
  ```

## Diff Examples:
  Compare a template with one on disk:
  ```
    $ fuse-tool diff -s ${SUB} -p ./template-manager_sample-slack-addon -u template-manager/sample-slack-addon
  ```

  Compare the files in a template's "template/" directory with children, found through "template.id=id":
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/
  ```

  Compare the files in a template's "template/" directory with children based on a search criteria:
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -c tags.type=slack
  ```

  Compare the files in a template's "template/" directory with children based on multiple search criteria:
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -c tags.type=slack compute.timeout=30
  ```

  Compare the files in a template's "template/" directory with a specific child:
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -u someboundary/somefunction
  ```

  Compare the files in an on-disk template's "template/" directory with a specific child:
  ```
    $ fuse-tool diff -s ${SUB} -p ./template-manager_sample-slack-addon -i template/ -u someboundary/somefunction
  ```

  Test how a function would change when using a script to modify the function directly:
  ```
    $ cat modify.js
		exports["fusebit.json"] = (j) => {
			j.compute.memorySize = 256;
			return j;
		};
		exports["package.json"] = (j) => {
			j.dependencies.superagent = "6.1.0";
			return j;
		};
    $ fuse-tool diff -s ${SUB} -u template-manager/sample-slack-addon --script modify.js
  ```

## Migrate Examples

  Migrate from one `fuse` profile to another:',
  ```
    $ fuse-tool migrate oldProfile newProfile',
  ```

  Migrate with explicit subscriptions:',
  ```
    $ fuse-tool migrate oldProfile newProfile -s sub-1234 -d sub-7890',
  ```

  Migrate from one `fuse` profile to another with a search criteria:',
  ```
    $ fuse-tool migrate oldProfile newProfile -c tags.type=slack',
  ```

## Options:
  ```
  -h, --help                   display help for command
  ```

## Commands:
  ```
  update [options] [template]  Update all of the functions were created by
                               the specified template with the files in
                               "template/"
                               For example '$ fuse-tool update
                               template-manager/sample-slack-addon -i template/
  diff [options] [template]    Diff the files in the derived functions with
                               the files in the template/ directory of the
                               specified template.
                               For example '$ fuse-tool diff
                               template-manager/sample-slack-addon'
  migrate [options] <sourceProfile> <destProfile>
                               Migrate functions from one subscription to another.
  help [command]               display help for command
  ```
