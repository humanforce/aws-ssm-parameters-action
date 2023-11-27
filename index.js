const core = require('@actions/core');
const { SSM } = require('aws-sdk');

const parsePathsInput = paths => {
  try {
    return paths.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  } catch(error) {
   throw new Error('Paths parameter cannot be parsed');
  }
}

const isTrue = (value) => value === 'true' ? true : false;

const configureInputs = () => {
  const inputPaths = core.getInput('paths');
  const inputRecursive = core.getInput('recursive');
  const inputOutputType = core.getInput('output-type');
  const inputWithDecryption = core.getInput('with-decryption');
  const inputSplitEnv = core.getInput('split-env');
  const inputUpperCase = core.getInput('upper-case');
  const inputEnvPrefix = core.getInput('env-prefix');

  return {
    paths: parsePathsInput(inputPaths),
    recursive: isTrue(inputRecursive),
    withDecryption: isTrue(inputWithDecryption),
    outputType: inputOutputType,
    envOptions: {
      splitEnv: isTrue(inputSplitEnv),
      upperCase: isTrue(inputUpperCase),
      envPrefix: inputEnvPrefix
    }
  }
}

const formatParameterName = (name, { splitEnv, upperCase, envPrefix }) => {
  let formattedName = name;
  if (splitEnv) {
    const splitted = name.split('/');
    formattedName = splitted[splitted.length-1];
  } else {
    if (formattedName.startsWith('/')) {
      formattedName = formattedName.substring(1);
    }
    formattedName = formattedName.replace(/\//g, '_');
  }
  if (upperCase) {
    formattedName = formattedName.toUpperCase();
  }
  if (envPrefix) {
    formattedName = `${envPrefix}${formattedName}`;
  }
  return formattedName;
}

const getParameter = async ({
  envOptions,
  path,
  recursive = false,
  withDecryption = false,
}) => {
  const ssm = new SSM();

  const parameters = {};

  let nextToken = undefined;

  do {
    const { Parameters, NextToken } = await ssm
      .getParametersByPath({
        Path: path,
        Recursive: recursive,
        WithDecryption: withDecryption,
        NextToken: nextToken,
      })
      .promise();

    Parameters.forEach((parameter) => {
      const name = formatParameterName(parameter.Name, envOptions);
      const value = parameter.Value.trim();

      if (parameter.Type === "SecureString") {
        core.setSecret(value);
      }

      parameters[name] = value;
    });

    nextToken = NextToken;
  } while (Boolean(nextToken));

  return parameters;
};

const reducer = (oldValue, newValue) => Object.assign(oldValue, newValue);

const saveToEnv = (parameters) => {
  Object.keys(parameters).forEach(key => {
    core.exportVariable(key, `${parameters[key]}`);
  });
}

const saveOutput = (parameters, outputType) => {
  switch (outputType) {
    default:
      saveToEnv(parameters)
  }
}

const run = async () => {
  try {
    const { paths, recursive, withDecryption, outputType, envOptions } = configureInputs();
    const parameters = await Promise.all(paths.map(path => getParameter({ path, recursive, withDecryption, envOptions })));
    const mergedParameters = parameters.reduce(reducer);
    saveOutput(mergedParameters, outputType);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
