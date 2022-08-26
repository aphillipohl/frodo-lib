import yesno from 'yesno';
import {
  createTable,
  printMessage,
  createProgressIndicator,
  updateProgressIndicator,
  stopProgressIndicator,
} from './utils/Console';
import { getSecrets } from '../api/SecretsApi';
import { getStatus, initiateRestart } from '../api/StartupApi';
import { resolveUserName } from './ManagedObjectOps';
import { getVariables } from '../api/VariablesApi';

export async function checkForUpdates() {
  createProgressIndicator(
    undefined,
    `Checking for updates to apply...`,
    'indeterminate'
  );
  const updates = createTable([
    'Type'.brightCyan,
    'Name'.brightCyan,
    'Modified'.brightCyan,
    'Modifier'.brightCyan,
  ]);
  let secrets = [];
  let variables = [];
  try {
    secrets = (await getSecrets()).data.result;
    for (const secret of secrets) {
      if (!secret.loaded) {
        updates.push([
          'secret',
          secret._id,
          new Date(secret.lastChangeDate).toLocaleString(),
          // eslint-disable-next-line no-await-in-loop
          await resolveUserName('teammember', secret.lastChangedBy),
        ]);
      }
    }
    variables = (await getVariables()).data.result;
    for (const variable of variables) {
      if (!variable.loaded) {
        updates.push([
          'variable',
          variable._id,
          new Date(variable.lastChangeDate).toLocaleString(),
          // eslint-disable-next-line no-await-in-loop
          await resolveUserName('teammember', variable.lastChangedBy),
        ]);
      }
    }
  } catch (error) {
    stopProgressIndicator(
      `Error: ${error.response.data.code} - ${error.response.data.message}`,
      'fail'
    );
  }
  if (updates.length > 0) {
    stopProgressIndicator(
      `${updates.length} update(s) need to be applied`,
      'success'
    );
    printMessage(updates.toString(), 'data');
    return true;
  }
  stopProgressIndicator(`No updates need to be applied`, 'success');
  return false;
}

export async function applyUpdates(force, wait, yes) {
  if ((await checkForUpdates()) || force) {
    const ok =
      yes ||
      (await yesno({
        question: `\nChanges may take up to 10 minutes to propagate, during which time you will not be able to make further updates.\n\nApply updates? (y|n):`,
      }));
    if (ok) {
      createProgressIndicator(
        undefined,
        `Applying updates...`,
        'indeterminate'
      );
      try {
        await initiateRestart();
        if (wait) {
          const timeout = 10 * 60 * 1000;
          const start = new Date().getTime();
          let runtime = 0;
          // eslint-disable-next-line no-await-in-loop
          let status = (await getStatus()).data.restartStatus;
          while (status !== 'ready' && start + timeout > new Date().getTime()) {
            // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
            await new Promise((resolve) => setTimeout(resolve, 5000));
            // eslint-disable-next-line no-await-in-loop
            status = (await getStatus()).data.restartStatus;
            runtime = new Date().getTime() - start;
            updateProgressIndicator(
              `${status} (${Math.round(runtime / 1000)}s)`
            );
          }
          if (runtime < timeout) {
            stopProgressIndicator(
              `Updates applied in ${Math.round(
                runtime / 1000
              )}s with final status: ${status}`,
              'success'
            );
          } else {
            stopProgressIndicator(
              `Updates timed out after ${Math.round(
                runtime / 1000
              )}s with final status: ${status}`,
              'success'
            );
          }
        } else {
          stopProgressIndicator(
            `Updates are being applied. Changes may take up to 10 minutes to propagate, during which time you will not be able to make further updates.`,
            'success'
          );
        }
      } catch (error) {
        stopProgressIndicator(
          `Error: ${error.response.data.code} - ${error.response.data.message}`,
          'fail'
        );
      }
    }
  }
}
