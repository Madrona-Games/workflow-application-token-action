import * as fs from 'fs';

interface TestData {
  [appName: string]: Record<string, unknown>;
}

const data: TestData | null = loadData();

export function getApplicationId(appName: string): unknown {
  return getAppTestValue(appName, 'applicationId');
}

export function getApplicationPrivateKey(appName: string): unknown {
  return getAppTestValue(appName, 'privateKey');
}

export function getTestRepository(appName: string): unknown {
  return getAppTestValue(appName, 'repo.repo');
}

export function getTestRepositoryOwner(appName: string): unknown {
  return getAppTestValue(appName, 'repo.owner');
}

export function getTestOrganization(appName: string): unknown {
  return getAppTestValue(appName, 'org');
}

function loadData(): TestData | null {
  const testDataFile = getTestDataFileName();

  let result: TestData | null = null;
  if (fs.existsSync(testDataFile)) {
    try {
      result = JSON.parse(fs.readFileSync(testDataFile, 'utf-8')) as TestData;
    } catch (err) {
      console.error(`Failed to parse data file ${testDataFile}: ${(err as Error).message}`);
      result = null;
    }
  }

  return result;
}

function getTestDataFileName(): string {
  return '.github_application';
}

function getAppTestValue(name: string, key: string): unknown {
  if (!data) {
    console.error(
      `No data for tests has been loaded, please ensure you have a valid file for testing at ${getTestDataFileName()}.`
    );
    return null;
  }

  const application = data[name];

  if (application) {
    if (key) {
      const keyPath = key.split('.');

      let target: unknown = application;
      keyPath.forEach((k) => {
        if (target && typeof target === 'object') {
          target = (target as Record<string, unknown>)[k];
        }
      });
      return target;
    }
  }
  return null;
}
