import fetch from "node-fetch";
import parser from "xml-js";
import childProcess from "child_process";
import ChromeLauncher from "chrome-launcher";
import http from "http";

async function getManuallyMappedChromedriver(): Promise<string> {
  // const prop = process.env.BROWSERNAME + ".chromedriver_ver";

  const chromedriverVer: string = "83.0.4103.116";
  return new Promise((resolve) => resolve(chromedriverVer));
}

export interface HTTPRequest {
  url: string;
  requestType: string;
  isJson?: boolean;
  payload?: string | object;
  headers?: object;
}

// const makeHTTPRequest = async (params: HTTPRequest) => {
//   const options: any = {
//     method: params.requestType,
//     uri: params.url,
//     proxy: (() => {
//       if (!process.env.JENKINS_CI) {
//         return process.env.httpProxy;
//       }
//       return null;
//     })(),
//     json: params.isJson !== undefined ? params.isJson : true,
//     resolveWithFullResponse: true,
//   };
//   if (
//     (params.requestType === "POST" ||
//       params.requestType === "POSTFORM" ||
//       params.requestType === "PUT" ||
//       params.requestType === "PATCH") &&
//     !params.payload
//   ) {
//     throw new Error("HTTP POST or PUT method should have a valid body");
//   } else if (params.requestType === "POSTFORM") {
//     options.method = "POST";
//     options.form =
//       typeof params.payload !== "string"
//         ? params.payload
//         : JSON.parse(params.payload);
//   } else {
//     options.body =
//       typeof params.payload !== "string"
//         ? params.payload
//         : JSON.parse(params.payload);
//   }

//   if (params.headers) options.headers = params.headers;

//   try {
//     return (await rp(options)).body;
//   } catch (err) {
//     console.log(
//       `Error in making ${params.requestType} HTTP request. Error is - ${
//         (err as any).message
//       }`
//     );
//     throw err;
//   }
// };

const runShellCommand = async (command: any) => {
  return new Promise(function (resolve, reject) {
    childProcess.exec(
      command,
      (err: any, commandOutput: any, commandError: any) => {
        const errorThrown = err || commandError;
        if (errorThrown) {
          reject(errorThrown);
          return;
        }
        resolve(commandOutput);
      }
    );
  });
};

const getRequestLocalChromeVersion = (options: any) => {
  return new Promise((resolve, reject) => {
    const request = http.get(options, (response: any) => {
      let data = "";
      response.on("data", (chunk: any) => {
        data += chunk;
      });
      response.on("end", () => {
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

    request.on("error", reject);
  });
};

async function getInstalledChromeVersion() {
  const chromeOpts = ["--no-sandbox", "--headless"];
  const chromeInstance = await ChromeLauncher.launch({ chromeOpts } as any);
  const options = {
    host: "127.0.0.1",
    port: chromeInstance.port,
    path: "/json/version",
    requestType: "GET",
  };
  const response: any = await getRequestLocalChromeVersion(options);
  await chromeInstance.kill();

  return response.Browser.split("/")[1];
}

async function readChromeVersionsJson() {
  const path = "http://omahaproxy.appspot.com/all.json";
  const requestType = "GET";
  const isJson = true;

  const value: any = await makeHTTPRequest({ url: path, requestType, isJson });

  const listJson = value.reduce((initValue: any, individualValue: any) => {
    Object.keys(individualValue).forEach((key) => {
      if (
        Object.prototype.hasOwnProperty.call(individualValue, key) &&
        individualValue[key] === "win64"
      ) {
        initValue = [...initValue, ...individualValue.versions]; // eslint-disable-line no-param-reassign
      }
    });
    return initValue;
  }, []);
  return listJson;
}

async function readChromedriverVersionXml() {
  const path = "http://chromedriver.storage.googleapis.com/";
  const requestType = "GET";
  const isJson = false;

  const options = { ignoreComment: true, alwaysChildren: true, compact: true };
  const data: any = await makeHTTPRequest({ url: path, requestType, isJson });
  if (data !== "undefined") {
    const result = parser.xml2js(data, options);
    const resultArray = (result as any).ListBucketResult.Contents;
    return resultArray;
  }
  return data;
}

async function readVersion(browserName: any) {
  let current_version: any;
  let chromedriver: any;
  if (process.env.JENKINS_CI) {
    current_version = await runShellCommand(
      "echo $(google-chrome --version | awk '{print $3}')"
    );
  } else if (process.env.USEINSTALLEDCHROMEVERSION === "true") {
    current_version = await getInstalledChromeVersion();
  } else {
    const versionList = await readChromeVersionsJson();
    ({ current_version } = versionList.reduce(
      (initValue: any, currentValue: any) => {
        Object.keys(currentValue).forEach((key) => {
          if (
            !!Object.getOwnPropertyDescriptor(currentValue, key) &&
            currentValue[key] === browserName
          ) {
            initValue = currentValue; // eslint-disable-line no-param-reassign
          }
        });
        return initValue;
      },
      ""
    ));
  }
  console.log(`Installed chrome browser version is ${current_version}`);
  current_version = current_version.substr(0, current_version.lastIndexOf("."));
  const resultArray = await readChromedriverVersionXml();

  do {
    chromedriver = getChromeDriverValue(resultArray, current_version);
    if (!chromedriver) {
      current_version = current_version.substr(0, current_version.indexOf("."));
      current_version = current_version - 1 + "\\.";
    }
  } while (!chromedriver && !isNaN(chromedriver));
  return chromedriver;
}

function getChromeDriverValue(resultArray: any, current_version: any) {
  let chromeDriverValue;
  for (let i = 0; i < resultArray.length; i++) {
    const input = new RegExp("^" + current_version);
    if (
      input.test(resultArray[i].Key._text) &&
      resultArray[i].Key._text.includes("win")
    ) {
      chromeDriverValue = resultArray[i].Key._text.replace(
        "/chromedriver_win32.zip",
        ""
      );
    }
  }
  return chromeDriverValue;
}
interface BrowsersList {
  [key: string]: string;
}

const browsers: BrowsersList = {
  "chrome-latest": "stable",
  "chrome-beta": "beta",
  "chrome-dev": "dev",
  "chrome-canary": "canary",
};

export async function getChromedriver() {
  let chromedriverValue: string;
  try {
    // const autoSelect = true;
    // process.env.CHROMEDRIVERAUTODETECT;

    // chromedriverValue = await readVersion(browsers[process.env.BROWSERNAME!]);
    chromedriverValue = await readVersion(browsers["chrome-latest"]);

    if (!chromedriverValue) {
      throw new Error(`Invalid chromedriver type of ${chromedriverValue}`);
    }
  } catch (err) {
    console.log("Error thrown in chromedriver auto selection: " + err);
    chromedriverValue = await getManuallyMappedChromedriver();
    console.log("Setting manually mapped chromedriver : " + chromedriverValue);
  }
  return chromedriverValue;
}

const handleFetch = async (api_url: string, options = {}) => {
  const startTime = Date.now();

  const response = await fetch(api_url, options);
  const endTime = Date.now() - startTime;
  if (response.status >= 400) {
    throw Error(response.statusText);
  }
  console.log(`Response received in ${endTime}ms`);
  return response;
};

const makeHTTPRequest = async (params: HTTPRequest) => {
  // const options: any = {
  //   method: params.requestType,
  //   uri: params.url,
  //   proxy: (() => {
  //     if (!process.env.JENKINS_CI) {
  //       return process.env.httpProxy;
  //     }
  //     return null;
  //   })(),
  //   json: params.isJson !== undefined ? params.isJson : true,
  //   resolveWithFullResponse: true,
  // };
  const options: any = {
    method: params.requestType,
    // body: xml,
    // headers: {'Content-Type': 'application/xml'},
  };

  if (
    (params.requestType === "POST" ||
      params.requestType === "POSTFORM" ||
      params.requestType === "PUT" ||
      params.requestType === "PATCH") &&
    !params.payload
  ) {
    throw new Error("HTTP POST or PUT method should have a valid body");
  } else if (params.requestType === "POSTFORM") {
    // options.method = "POST";
    options.form =
      typeof params.payload !== "string"
        ? params.payload
        : JSON.parse(params.payload);
  } else {
    options.body =
      typeof params.payload !== "string"
        ? params.payload
        : JSON.parse(params.payload);
  }

  if (params.headers) options.headers = params.headers;

  try {
    const response = await handleFetch(params.url, options);
    return params.isJson ? response.json() : response.text();
  } catch (err) {
    console.log(
      `Error in making ${params.requestType} HTTP request. Error is - ${
        (err as any).message
      }`
    );
    throw err;
  }
};
