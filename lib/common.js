const util = require("util");
const process = require("process");

const fse = require("fs-extra");
const tmp = require("tmp");

class ClientError extends Error {}

class TimeoutError extends Error {}

function log(prefix, obj) {
  if (process.env.NODE_ENV !== "test") {
    const str = obj.map(o => (typeof o === "object" ? inspect(o) : o));
    if (prefix) {
      console.log.apply(console, [prefix, ...str]);
    } else {
      console.log.apply(console, str);
    }
  }
}

const logger = {
  level: "info",

  trace: (...str) => {
    if (logger.level === "trace") {
      log("TRACE", str);
    }
  },

  debug: (...str) => {
    if (logger.level === "trace" || logger.level === "debug") {
      log("DEBUG", str);
    }
  },

  info: (...str) => log("INFO ", str),

  error: (...str) => {
    if (str.length === 1) {
      if (str[0] instanceof Error) {
        if (logger.level === "trace" || logger.level === "debug") {
          log(null, [str[0].stack || str[0]]);
        } else {
          log("ERROR", [str[0].message || str[0]]);
        }
      }
    } else {
      log("ERROR", str);
    }
  }
};

function inspect(obj) {
  return util.inspect(obj, false, null, true);
}

function createConfig(env = {}) {
  function parseMergeLabels(str, defaultValue) {
    const arr = (str == null ? defaultValue : str)
      .split(",")
      .map(s => s.trim());
    return {
      required: arr.filter(s => !s.startsWith("!") && s.length > 0),
      blocking: arr
        .filter(s => s.startsWith("!"))
        .map(s => s.substr(1).trim())
        .filter(s => s.length > 0)
    };
  }

  function parseMergeRemoveLabels(str, defaultValue) {
    return (str == null ? defaultValue : str)
      .split(",")
      .map(s => s.trim())
  }

  function parsePositiveInt(name, defaultValue) {
    const val = env[name];
    if (val == null || val === "") {
      return defaultValue;
    } else {
      const number = parseInt(val);
      if (isNaN(number) || number < 0) {
        throw new ClientError(`Not a positive integer: ${val}`);
      } else {
        return number;
      }
    }
  }

  const mergeLabels = parseMergeLabels(env.MERGE_LABELS, "automerge");
  const mergeRemoveLabels = parseMergeRemoveLabels(env.MERGE_REMOVE_LABELS, "");
  const mergeMethod = env.MERGE_METHOD || "merge";
  const mergeForks = env.MERGE_FORKS !== "false";
  const mergeCommitMessage = env.MERGE_COMMIT_MESSAGE || "automatic";
  const mergeCommitMessageRegex = env.MERGE_COMMIT_MESSAGE_REGEX || '';
  const mergeRetries = parsePositiveInt("MERGE_RETRIES", 6);
  const mergeRetrySleep = parsePositiveInt("MERGE_RETRY_SLEEP", 10000);
  const mergeDeleteBranch = env.MERGE_DELETE_BRANCH === "true";

  const updateLabels = parseMergeLabels(env.UPDATE_LABELS, "automerge");
  const updateMethod = env.UPDATE_METHOD || "merge";

  return {
    mergeLabels,
    mergeRemoveLabels,
    mergeMethod,
    mergeForks,
    mergeCommitMessage,
    mergeCommitMessageRegex,
    mergeRetries,
    mergeRetrySleep,
    mergeDeleteBranch,
    updateLabels,
    updateMethod
  };
}

function tmpdir(callback) {
  async function handle(path) {
    try {
      return await callback(path);
    } finally {
      await fse.remove(path);
    }
  }
  return new Promise((resolve, reject) => {
    tmp.dir((err, path) => {
      if (err) {
        reject(err);
      } else {
        handle(path).then(resolve, reject);
      }
    });
  });
}

async function retry(retries, sleep, doInitial, doRetry, doFailed) {
  const initialResult = await doInitial();
  if (initialResult === "success") {
    return true;
  } else if (initialResult === "failure") {
    return false;
  } else if (initialResult !== "retry") {
    throw new Error(`invalid return value: ${initialResult}`);
  }

  for (let run = 1; run <= retries; run++) {
    if (sleep === 0) {
      logger.info(`Retrying ... (${run}/${retries})`);
    } else {
      logger.info(`Retrying after ${sleep} ms ... (${run}/${retries})`);
      await doSleep(sleep);
    }

    const retryResult = await doRetry();
    if (retryResult === "success") {
      return true;
    } else if (retryResult === "failure") {
      return false;
    } else if (retryResult !== "retry") {
      throw new Error(`invalid return value: ${initialResult}`);
    }
  }

  await doFailed();
  return false;
}

function doSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  ClientError,
  TimeoutError,
  logger,
  createConfig,
  tmpdir,
  inspect,
  retry
};
