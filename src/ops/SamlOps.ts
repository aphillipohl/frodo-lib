import fs from 'fs';
import _ from 'lodash';
import { decode, encode, encodeBase64Url } from '../api/utils/Base64';
import {
  createTable,
  printMessage,
  createProgressIndicator,
  updateProgressIndicator,
  stopProgressIndicator,
  createObjectTable,
} from './utils/Console';
import {
  getProviders,
  findProviders,
  getProviderByLocationAndId,
  getProviderMetadata,
  createProvider,
  getProviderMetadataUrl,
} from '../api/Saml2Api';
import { getScript } from '../api/ScriptApi';
import {
  convertBase64TextToArray,
  convertBase64UrlTextToArray,
  convertTextArrayToBase64,
  convertTextArrayToBase64Url,
  getRealmString,
  getTypedFilename,
  saveJsonToFile,
  saveTextToFile,
  validateImport,
} from './utils/ExportImportUtils';
import { createOrUpdateScript } from './ScriptOps';

const roleMap = {
  identityProvider: 'IDP',
  serviceProvider: 'SP',
  attributeQueryProvider: 'AttrQuery',
  xacmlPolicyEnforcementPoint: 'XACML PEP',
};

// use a function vs a template variable to avoid problems in loops
function getFileDataTemplate() {
  return {
    meta: {},
    script: {},
    saml: {
      hosted: {},
      remote: {},
      metadata: {},
    },
  };
}

/**
 * List entity providers
 * @param {boolean} long Long list format with details
 */
export async function listProviders(long = false) {
  const providerList = (await getProviders()).data.result;
  providerList.sort((a, b) => a._id.localeCompare(b._id));
  if (!long) {
    providerList.forEach((item) => {
      printMessage(`${item.entityId}`, 'data');
    });
  } else {
    const table = createTable([
      'Entity Id'['brightCyan'],
      'Location'['brightCyan'],
      'Role(s)'['brightCyan'],
    ]);
    providerList.forEach((provider) => {
      table.push([
        provider.entityId,
        provider.location,
        provider.roles.map((role) => roleMap[role]).join(', '),
      ]);
    });
    printMessage(table.toString());
  }
}

/**
 * Include dependencies in the export file
 * @param {Object} providerData Object representing a SAML entity provider
 * @param {Object} fileData File data object to add dependencies to
 */
async function exportDependencies(providerData, fileData) {
  const attrMapperScriptId = _.get(providerData, [
    'identityProvider',
    'assertionProcessing',
    'attributeMapper',
    'attributeMapperScript',
  ]);
  if (attrMapperScriptId && attrMapperScriptId !== '[Empty]') {
    const scriptData = (await getScript(attrMapperScriptId)).data;
    scriptData.script = convertBase64TextToArray(scriptData.script);
    // eslint-disable-next-line no-param-reassign
    fileData.script[attrMapperScriptId] = scriptData;
  }
  const idpAdapterScriptId = _.get(providerData, [
    'identityProvider',
    'advanced',
    'idpAdapter',
    'idpAdapterScript',
  ]);
  if (idpAdapterScriptId && idpAdapterScriptId !== '[Empty]') {
    const scriptData = (await getScript(idpAdapterScriptId)).data;
    scriptData.script = convertBase64TextToArray(scriptData.script);
    // eslint-disable-next-line no-param-reassign
    fileData.script[idpAdapterScriptId] = scriptData;
  }
  const metaDataResponse = await getProviderMetadata(providerData.entityId);
  // eslint-disable-next-line no-param-reassign
  fileData.saml.metadata[providerData._id] = convertBase64UrlTextToArray(
    encodeBase64Url(metaDataResponse.data)
  );
}

/**
 * Export a single entity provider to file
 * @param {String} entityId Provider entity id
 * @param {String} file Optional filename
 */
export async function exportProvider(entityId, file = null) {
  let fileName = file;
  if (!fileName) {
    fileName = getTypedFilename(entityId, 'saml');
  }
  createProgressIndicator(1, `Exporting provider ${entityId}`);
  const found = await findProviders(`entityId eq '${entityId}'`, 'location');
  switch (found.data.resultCount) {
    case 0:
      printMessage(`No provider with entity id '${entityId}' found`, 'error');
      break;
    case 1:
      {
        const { location } = found.data.result[0];
        const id = found.data.result[0]._id;
        getProviderByLocationAndId(location, id)
          .then(async (response) => {
            const providerData = response.data;
            updateProgressIndicator(`Writing file ${fileName}`);
            const fileData = getFileDataTemplate();
            fileData.saml[location][providerData._id] = providerData;
            await exportDependencies(providerData, fileData);
            saveJsonToFile(fileData, fileName);
            stopProgressIndicator(
              `Exported ${entityId.brightCyan} to ${fileName.brightCyan}.`
            );
          })
          .catch((err) => {
            stopProgressIndicator(`${err}`);
            printMessage(err, 'error');
          });
      }
      break;
    default:
      printMessage(
        `Multiple providers with entity id '${entityId}' found`,
        'error'
      );
  }
}

/**
 * Export provider metadata to file
 * @param {String} entityId Provider entity id
 * @param {String} file Optional filename
 */
export async function exportMetadata(entityId, file = null) {
  let fileName = file;
  if (!fileName) {
    fileName = getTypedFilename(entityId, 'metadata', 'xml');
  }
  createProgressIndicator(1, `Exporting metadata for: ${entityId}`);
  getProviderMetadata(entityId)
    .then(async (response) => {
      updateProgressIndicator(`Writing file ${fileName}`);
      // printMessage(response.data, 'error');
      const metaData = response.data;
      saveTextToFile(metaData, fileName);
      stopProgressIndicator(
        `Exported ${entityId.brightCyan} metadata to ${fileName.brightCyan}.`
      );
    })
    .catch((err) => {
      stopProgressIndicator(`${err}`);
      printMessage(err, 'error');
    });
}

/**
 * Describe an entity provider's configuration
 * @param {String} entityId Provider entity id
 */
export async function describeProvider(entityId) {
  const found = await findProviders(
    `entityId eq '${entityId}'`,
    'location,roles'
  );
  switch (found.data.resultCount) {
    case 0:
      printMessage(`No provider with entity id '${entityId}' found`, 'error');
      break;
    case 1:
      {
        const { location } = found.data.result[0];
        const id = found.data.result[0]._id;
        const roles = found.data.result[0].roles
          .map((role) => roleMap[role])
          .join(', ');
        getProviderByLocationAndId(location, id)
          .then(async (response) => {
            const rawProviderData = response.data;
            delete rawProviderData._id;
            delete rawProviderData._rev;
            rawProviderData.location = location;
            rawProviderData.roles = roles;
            rawProviderData.metadataUrl = getProviderMetadataUrl(entityId);
            // const fullProviderData = getFileDataTemplate();
            // fullProviderData.saml[location][rawProviderData._id] =
            //   rawProviderData;
            // await exportDependencies(rawProviderData, fullProviderData);
            // describe the provider
            const table = createObjectTable(rawProviderData);
            printMessage(table.toString());
          })
          .catch((err) => {
            printMessage(err, 'error');
          });
      }
      break;
    default:
      printMessage(
        `Multiple providers with entity id '${entityId}' found`,
        'error'
      );
  }
}

/**
 * Export all entity providers to one file
 * @param {String} file Optional filename
 */
export async function exportProvidersToFile(file = null) {
  let fileName = file;
  if (!fileName) {
    fileName = getTypedFilename(`all${getRealmString()}Providers`, 'saml');
  }
  const fileData = getFileDataTemplate();
  const found = await getProviders();
  if (found.status < 200 || found.status > 399) {
    printMessage(found, 'data');
    printMessage(`exportProvidersToFile: ${found.status}`, 'error');
  } else if (found.data.resultCount > 0) {
    createProgressIndicator(found.data.resultCount, 'Exporting providers');
    for (const stubData of found.data.result) {
      updateProgressIndicator(`Exporting provider ${stubData.entityId}`);
      // eslint-disable-next-line no-await-in-loop
      const response = await getProviderByLocationAndId(
        stubData.location,
        stubData._id
      );
      const providerData = response.data;
      // eslint-disable-next-line no-await-in-loop
      await exportDependencies(providerData, fileData);
      fileData.saml[stubData.location][providerData._id] = providerData;
    }
    saveJsonToFile(fileData, fileName);
    stopProgressIndicator(
      `${found.data.resultCount} providers exported to ${fileName}.`
    );
  } else {
    printMessage('No entity providers found.', 'info');
  }
}

/**
 * Export all entity providers to individual files
 */
export async function exportProvidersToFiles() {
  const found = await getProviders();
  if (found.data.resultCount > 0) {
    createProgressIndicator(found.data.resultCount, 'Exporting providers');
    for (const stubData of found.data.result) {
      updateProgressIndicator(`Exporting provider ${stubData.entityId}`);
      const fileName = getTypedFilename(stubData.entityId, 'saml');
      const fileData = getFileDataTemplate();
      // eslint-disable-next-line no-await-in-loop
      const response = await getProviderByLocationAndId(
        stubData.location,
        stubData._id
      );
      const providerData = response.data;
      // eslint-disable-next-line no-await-in-loop
      await exportDependencies(providerData, fileData);
      fileData.saml[stubData.location][providerData._id] = providerData;
      saveJsonToFile(fileData, fileName);
    }
    stopProgressIndicator(`${found.data.resultCount} providers exported.`);
  } else {
    printMessage('No entity providers found.', 'info');
  }
}

/**
 * Include dependencies from the import file
 * @param {Object} providerData Object representing a SAML entity provider
 * @param {Object} fileData File data object to read dependencies from
 */
async function importDependencies(providerData, fileData) {
  const attrMapperScriptId = _.get(providerData, [
    'identityProvider',
    'assertionProcessing',
    'attributeMapper',
    'attributeMapperScript',
  ]);
  if (attrMapperScriptId && attrMapperScriptId !== '[Empty]') {
    const scriptData = _.get(fileData, ['script', attrMapperScriptId]);
    scriptData.script = convertTextArrayToBase64(scriptData.script);
    await createOrUpdateScript(attrMapperScriptId, scriptData);
  }
  const idpAdapterScriptId = _.get(providerData, [
    'identityProvider',
    'advanced',
    'idpAdapter',
    'idpAdapterScript',
  ]);
  if (idpAdapterScriptId && idpAdapterScriptId !== '[Empty]') {
    const scriptData = _.get(fileData, ['script', idpAdapterScriptId]);
    scriptData.script = convertTextArrayToBase64(scriptData.script);
    await createOrUpdateScript(attrMapperScriptId, scriptData);
  }
}

/**
 * Find provider in import file and return its location
 * @param {String} entityId64 Base64-encoded provider entity id
 * @param {Object} fileData Import file json data
 * @returns {String} 'hosted' or 'remote' if found, undefined otherwise
 */
function getLocation(entityId64, fileData) {
  if (_.get(fileData, ['saml', 'hosted', entityId64])) {
    return 'hosted';
  }
  if (_.get(fileData, ['saml', 'remote', entityId64])) {
    return 'remote';
  }
  return undefined;
}

/**
 * Import a SAML entity provider by entity id from file
 * @param {String} entityId Provider entity id
 * @param {String} file Import file name
 */
export async function importProvider(entityId, file) {
  const entityId64 = encode(entityId, false);
  fs.readFile(file, 'utf8', async (err, data) => {
    if (err) throw err;
    const fileData = JSON.parse(data);
    if (validateImport(fileData.meta)) {
      createProgressIndicator(1, 'Importing provider...');
      const location = getLocation(entityId64, fileData);
      if (location) {
        const providerData = _.get(fileData, ['saml', location, entityId64]);
        updateProgressIndicator(`Importing ${entityId}`);
        await importDependencies(providerData, fileData);
        let metaData = null;
        if (location === 'remote') {
          metaData = convertTextArrayToBase64Url(
            fileData.saml.metadata[entityId64]
          );
        }
        createProvider(location, providerData, metaData)
          .then(() => {
            stopProgressIndicator(
              `Successfully imported provider ${entityId}.`
            );
          })
          .catch((createProviderErr) => {
            printMessage(`\nError importing provider ${entityId}`, 'error');
            printMessage(createProviderErr.response, 'error');
          });
      } else {
        stopProgressIndicator(
          `Provider ${entityId.brightCyan} not found in ${file.brightCyan}!`
        );
      }
    } else {
      printMessage('Import validation failed...', 'error');
    }
  });
}

/**
 * Import first SAML entity provider from file
 * @param {String} file Import file name
 */
export async function importFirstProvider(file) {
  fs.readFile(file, 'utf8', async (err, data) => {
    if (err) throw err;
    const fileData = JSON.parse(data);
    if (validateImport(fileData.meta)) {
      createProgressIndicator(1, 'Importing provider...');
      // find providers in hosted and if none exist in remote
      let location = 'hosted';
      let providerIds = _.keys(fileData.saml[location]);
      if (providerIds.length === 0) {
        location = 'remote';
        providerIds = _.keys(fileData.saml[location]);
        if (providerIds.length === 0) {
          location = null;
        }
      }
      if (location) {
        const entityId64 = providerIds[0];
        const entityId = decode(entityId64);
        const providerData = _.get(fileData, ['saml', location, entityId64]);
        updateProgressIndicator(`Importing ${entityId}`);
        await importDependencies(providerData, fileData);
        let metaData = null;
        if (location === 'remote') {
          metaData = convertTextArrayToBase64Url(
            fileData.saml.metadata[entityId64]
          );
        }
        createProvider(location, providerData, metaData)
          .then(() => {
            stopProgressIndicator(
              `Successfully imported provider ${entityId}.`
            );
          })
          .catch((createProviderErr) => {
            stopProgressIndicator(`Error importing provider ${entityId}`);
            printMessage(`\nError importing provider ${entityId}`, 'error');
            printMessage(createProviderErr.response.data, 'error');
          });
      } else {
        stopProgressIndicator(`No providers found in ${file.brightCyan}!`);
      }
    } else {
      printMessage('Import validation failed...', 'error');
    }
  });
}

/**
 * Import all SAML entity providers from file
 * @param {String} file Import file name
 */
export async function importProvidersFromFile(file) {
  fs.readFile(file, 'utf8', async (err, data) => {
    if (err) throw err;
    const fileData = JSON.parse(data);
    if (validateImport(fileData.meta)) {
      // find providers in hosted and in remote and map locations
      const hostedIds = _.keys(fileData.saml.hosted);
      const remoteIds = _.keys(fileData.saml.remote);
      const providerIds = hostedIds.concat(remoteIds);
      createProgressIndicator(providerIds.length, 'Importing providers...');
      for (const entityId64 of providerIds) {
        const location = hostedIds.includes(entityId64) ? 'hosted' : 'remote';
        const entityId = decode(entityId64);
        const providerData = _.get(fileData, ['saml', location, entityId64]);
        // eslint-disable-next-line no-await-in-loop
        await importDependencies(providerData, fileData);
        let metaData = null;
        if (location === 'remote') {
          metaData = convertTextArrayToBase64Url(
            fileData.saml.metadata[entityId64]
          );
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await createProvider(location, providerData, metaData);
          updateProgressIndicator(`Imported ${entityId}`);
        } catch (createProviderErr) {
          printMessage(`\nError importing provider ${entityId}`, 'error');
          printMessage(createProviderErr.response.data, 'error');
        }
      }
      stopProgressIndicator(`Providers imported.`);
    } else {
      printMessage('Import validation failed...', 'error');
    }
  });
}

/**
 * Import all SAML entity providers from all *.saml.json files in the current directory
 */
export async function importProvidersFromFiles() {
  const names = fs.readdirSync('.');
  const jsonFiles = names.filter((name) =>
    name.toLowerCase().endsWith('.saml.json')
  );
  createProgressIndicator(jsonFiles.length, 'Importing providers...');
  let total = 0;
  let totalErrors = 0;
  for (const file of jsonFiles) {
    const data = fs.readFileSync(file, 'utf8');
    const fileData = JSON.parse(data);
    if (validateImport(fileData.meta)) {
      // find providers in hosted and in remote and map locations
      const hostedIds = _.keys(fileData.saml.hosted);
      const remoteIds = _.keys(fileData.saml.remote);
      const providerIds = hostedIds.concat(remoteIds);
      total += providerIds.length;
      let errors = 0;
      for (const entityId64 of providerIds) {
        const location = hostedIds.includes(entityId64) ? 'hosted' : 'remote';
        const entityId = decode(entityId64);
        const providerData = _.get(fileData, ['saml', location, entityId64]);
        importDependencies(providerData, fileData);
        let metaData = null;
        if (location === 'remote') {
          metaData = convertTextArrayToBase64Url(
            fileData.saml.metadata[entityId64]
          );
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await createProvider(location, providerData, metaData);
          // updateProgressIndicator(`Imported ${entityId}`);
        } catch (createProviderErr) {
          errors += 1;
          printMessage(`\nError importing provider ${entityId}`, 'error');
          printMessage(createProviderErr.response.data, 'error');
        }
      }
      totalErrors += errors;
      updateProgressIndicator(
        `Imported ${providerIds.length - errors} provider(s) from ${file}`
      );
    } else {
      printMessage(`Validation of ${file} failed!`, 'error');
    }
  }
  stopProgressIndicator(
    `Imported ${total - totalErrors} of ${total} provider(s) from ${
      jsonFiles.length
    } file(s).`
  );
}
