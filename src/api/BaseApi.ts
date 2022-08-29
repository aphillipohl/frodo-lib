import axios, { AxiosProxyConfig } from 'axios';
import axiosRetry from 'axios-retry';
import * as https from 'https';
import HttpsProxyAgent from 'https-proxy-agent';
import url from 'url';
import fs from 'fs';
import storage from '../storage/SessionStorage';
import { getTenantURL } from './utils/ApiUtils';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
);

axiosRetry(axios, {
  retries: 3,
  shouldResetTimeout: true,
  retryCondition: (_error) => true, // retry no matter what
});

const timeout = 30000;
const userAgent = `${pkg.name}/${pkg.version}`;
let httpsAgent;

/**
 * Helper method to create properly configured httpsAgent
 * @returns {any} appropriate httpsAgent
 */
function getHttpsAgent() {
  if (httpsAgent) return httpsAgent;
  const options = {
    rejectUnauthorized: !storage.session.getAllowInsecureConnection(),
  };
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpsProxy) {
    // https://github.com/axios/axios/issues/3459
    console.error(`Using proxy ${httpsProxy}`['yellow']);
    const parsed = url.parse(httpsProxy);
    options['host'] = parsed.hostname;
    options['port'] = parsed.port;
    options['protocol'] = parsed.protocol;
    options.rejectUnauthorized = !storage.session.getAllowInsecureConnection();
    httpsAgent = HttpsProxyAgent(options);
    return httpsAgent;
  }
  httpsAgent = new https.Agent(options);
  return httpsAgent;
}

/**
 * Get Proxy config
 * @returns {AxiosProxyConfig | false} axios proxy config or false
 */
function getProxy(): AxiosProxyConfig | false {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return false;
  return null;
}

/**
 * Generates an AM Axios API instance
 * @param {object} resource Takes an object takes a resource object. example:
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either
 * add on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateAmApi(resource, requestOverride = {}) {
  let headers = {
    'User-Agent': userAgent,
    'Content-Type': 'application/json',
    'Accept-API-Version': resource.apiVersion,
    Cookie: `${storage.session.getCookieName()}=${storage.session.getCookieValue()}`,
  };
  if (requestOverride['headers']) {
    headers = {
      ...headers,
      ...requestOverride['headers'],
    };
  }

  const requestDetails = {
    baseURL: `${storage.session.getTenant()}/json`,
    timeout,
    ...requestOverride,
    headers,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  const request = axios.create(requestDetails);

  return request;
}

/**
 * Generates an OAuth2 Axios API instance
 * @param {object} resource Takes an object takes a resource object. example:
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either
 * add on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateOauth2Api(resource, requestOverride = {}) {
  let headers = {
    'User-Agent': userAgent,
    'Accept-API-Version': resource.apiVersion,
    Cookie: `${storage.session.raw['cookieName']}=${storage.session.raw['cookieValue']}`,
  };
  if (requestOverride['headers']) {
    headers = {
      ...headers,
      ...requestOverride['headers'],
    };
  }

  const requestDetails = {
    baseURL: `${storage.session.getTenant()}/json${resource.path}`,
    timeout,
    ...requestOverride,
    headers,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  const request = axios.create(requestDetails);

  return request;
}

/**
 * Generates an IDM Axios API instance
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either add
 * on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateIdmApi(requestOverride = {}) {
  const requestDetails = {
    baseURL: getTenantURL(storage.session.getTenant()),
    timeout,
    headers: {
      'User-Agent': userAgent,
      'Content-Type': 'application/json',
    },
    ...requestOverride,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  if (storage.session.getBearerToken()) {
    requestDetails.headers[
      'Authorization'
    ] = `Bearer ${storage.session.getBearerToken()}`;
  }

  const request = axios.create(requestDetails);

  return request;
}

/**
 * Generates a LogKeys API Axios instance
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either add
 * on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateLogKeysApi(requestOverride = {}) {
  const headers = {
    'User-Agent': userAgent,
    'Content-Type': 'application/json',
  };
  const requestDetails = {
    baseURL: getTenantURL(storage.session.getTenant()),
    timeout,
    headers,
    ...requestOverride,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  if (storage.session.getBearerToken()) {
    requestDetails.headers[
      'Authorization'
    ] = `Bearer ${storage.session.getBearerToken()}`;
  }

  const request = axios.create(requestDetails);

  return request;
}

/**
 * Generates a Log API Axios instance
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either add
 * on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateLogApi(requestOverride = {}) {
  const headers = {
    'User-Agent': userAgent,
    'X-API-Key': storage.session.getLogApiKey(),
    'X-API-Secret': storage.session.getLogApiSecret(),
  };
  const requestDetails = {
    baseURL: getTenantURL(storage.session.getTenant()),
    timeout,
    headers,
    ...requestOverride,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  const request = axios.create(requestDetails);

  return request;
}

/**
 * Generates an ESV Axios API instance for Environment Secrets and Variables
 * @param {object} requestOverride Takes an object of AXIOS parameters that can be used to either add
 * on extra information or override default properties https://github.com/axios/axios#request-config
 *
 * @returns {AxiosInstance}
 */
export function generateESVApi(resource, requestOverride = {}) {
  const headers = {
    'User-Agent': userAgent,
    'Content-Type': 'application/json',
    'Accept-API-Version': resource.apiVersion,
  };
  const requestDetails = {
    baseURL: getTenantURL(storage.session.getTenant()),
    timeout,
    headers,
    ...requestOverride,
    httpsAgent: getHttpsAgent(),
    proxy: getProxy(),
  };

  if (storage.session.getBearerToken()) {
    requestDetails.headers[
      'Authorization'
    ] = `Bearer ${storage.session.getBearerToken()}`;
  }

  const request = axios.create(requestDetails);

  return request;
}
