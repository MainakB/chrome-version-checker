/* eslint-disable no-console */
import fetch from 'node-fetch';
import parser from 'xml-js';
import childProcess from 'child_process';
import {launch} from 'chrome-launcher';
import http from 'http';

export interface HTTPRequest {
  url: string;
  requestType: string;
  isJson?: boolean;
  payload?: string | object;
  headers?: object;
}

const runShellCommand = async (command: any) =>
  new Promise((resolve, reject) => {
    childProcess.exec(command, (err: any, commandOutput: any, commandError: any) => {
      const errorThrown = err || commandError;
      if (errorThrown) {
        reject(errorThrown);
        return;
      }
      resolve(commandOutput);
    });
  });

const getRequestLocalChromeVersion = (options: any) =>
  new Promise((resolve, reject) => {
    const request = http.get(options, (response: any) => {
      let data = '';
      response.on('data', (chunk: any) => {
        data += chunk;
      });
      response.on('end', () => {
        if (response.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(data));
        }
      });
    });
    request.setTimeout(5000, () => {
      request.abort();
    });

    request.on('error', reject);
  });

async function getInstalledChromeVersion() {
  const chromeOpts = ['--no-sandbox', '--headless'];
  const chromeInstance = await launch({chromeOpts} as any);
  const options = {
    host: '127.0.0.1',
    port: chromeInstance.port,
    path: '/json/version',
    requestType: 'GET',
  };
  const response: any = await getRequestLocalChromeVersion(options);
  await chromeInstance.kill();

  return response.Browser.split('/')[1];
}

const handleFetch = async (apiUrl: string, options = {}) => {
  const startTime = Date.now();

  const response = await fetch(apiUrl, options);
  const endTime = Date.now() - startTime;
  if (response.status >= 400) {
    throw Error(response.statusText);
  }
  console.log(`Response received in ${endTime}ms`);
  return response;
};

const makeHTTPRequest = async (params: HTTPRequest) => {
  const options: any = {
    method: params.requestType,
  };

  if (
    (params.requestType === 'POST' ||
      params.requestType === 'POSTFORM' ||
      params.requestType === 'PUT' ||
      params.requestType === 'PATCH') &&
    !params.payload
  ) {
    throw new Error('HTTP POST or PUT method should have a valid body');
  } else if (params.requestType === 'POSTFORM') {
    // options.method = "POST";
    options.form = typeof params.payload !== 'string' ? params.payload : JSON.parse(params.payload);
  } else {
    options.body = typeof params.payload !== 'string' ? params.payload : JSON.parse(params.payload);
  }

  if (params.headers) options.headers = params.headers;

  try {
    const response = await handleFetch(params.url, options);
    return params.isJson ? response.json() : response.text();
  } catch (err) {
    console.log(`Error in making ${params.requestType} HTTP request. Error is - ${(err as any).message}`);
    throw err;
  }
};

async function readChromedriverVersionXml() {
  const path = 'http://chromedriver.storage.googleapis.com/';
  const requestType = 'GET';
  const isJson = false;

  const options = {ignoreComment: true, alwaysChildren: true, compact: true};
  const data: any = await makeHTTPRequest({url: path, requestType, isJson});
  if (data !== 'undefined') {
    const result = parser.xml2js(data, options);
    const resultArray = (result as any).ListBucketResult.Contents;
    return resultArray;
  }
  return data;
}

function getChromeDriverValue(resultArray: any, currentVersion: any) {
  let chromeDriverValue;
  for (let i = 0; i < resultArray.length; i++) {
    const input = new RegExp('^' + currentVersion);
    if (input.test(resultArray[i].Key._text) && resultArray[i].Key._text.includes('win')) {
      chromeDriverValue = resultArray[i].Key._text.replace('/chromedriver_win32.zip', '');
    }
  }
  return chromeDriverValue;
}

async function readVersion() {
  let currentVersion: any;
  let chromedriver: any;
  if (process.env.JENKINS_CI) {
    currentVersion = await runShellCommand("echo $(google-chrome --version | awk '{print $3}')");
  } else {
    currentVersion = await getInstalledChromeVersion();
  }
  console.log(`Installed chrome browser version is ${currentVersion}`);
  currentVersion = currentVersion.substr(0, currentVersion.lastIndexOf('.'));
  const resultArray = await readChromedriverVersionXml();

  do {
    chromedriver = getChromeDriverValue(resultArray, currentVersion);
    if (!chromedriver) {
      currentVersion = currentVersion.substr(0, currentVersion.indexOf('.'));
      currentVersion = currentVersion - 1 + '\\.';
    }
  } while (!chromedriver && !isNaN(chromedriver));
  return chromedriver;
}

export async function getChromedriver() {
  let chromedriverValue: string;
  try {
    chromedriverValue = await readVersion();

    if (!chromedriverValue) {
      throw new Error(`Invalid chromedriver type of ${chromedriverValue}`);
    }
  } catch (err) {
    throw new Error('Error thrown in chromedriver auto selection: ' + err);
  }
  return chromedriverValue;
}
