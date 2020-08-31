# Install

Run `npm link` to install as a command line tool.

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

  Compare the files in a template's "template/" directory with children based on a search criteria:
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -c tags.type=slack
  ```

  Compare the files in a template's "template/" directory with a specific child:
  ```
    $ fuse-tool diff -s ${SUB} template-manager/sample-slack-addon -i template/ -u someboundary/somefunction
  ```

  Compare the files in an on-disk template's "template/" directory with a specific child:
  ```
    $ fuse-tool diff -s ${SUB} -p ./template-manager_sample-slack-addon -i template/ -u someboundary/somefunction
  ```

Options:
  ```
  -h, --help                   display help for command
  ```

Commands:
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
  help [command]               display help for command
  ```
