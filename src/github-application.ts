import * as jwt from 'jsonwebtoken';
import * as github from '@actions/github';
import * as core from '@actions/core';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { PrivateKey } from './private-key';

type OctokitClient = ReturnType<typeof github.getOctokit>;

interface AppConfig {
  privateKey: PrivateKey;
  id: string;
}

interface AppMetadata {
  id: number;
  name: string;
  owner: Record<string, unknown>;
  permissions: Record<string, string>;
  installations_count: number;
  [key: string]: unknown;
}

interface Installation {
  id: number;
  permissions: Record<string, string>;
  [key: string]: unknown;
}

interface AccessToken {
  token: string;
  permissions?: Record<string, string>;
  [key: string]: unknown;
}

export async function create(
  privateKey: string,
  applicationId: string,
  baseApiUrl?: string,
  timeout?: number | null,
  proxy?: string
): Promise<GitHubApplication> {
  const app = new GitHubApplication(privateKey, applicationId, baseApiUrl);
  await app.connect(timeout ?? undefined, proxy);
  return app;
}

export async function revokeAccessToken(
  token: string,
  baseUrl?: string,
  proxy?: string
): Promise<boolean> {
  // The token being provided is the one to be invalidated
  const client = getOctokit(token, baseUrl, proxy);

  try {
    const resp = await client.rest.apps.revokeInstallationAccessToken();
    if (resp.status === 204) {
      return true;
    }
    throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unexpected status code')) {
      throw err;
    }
    throw new Error(`Failed to revoke application token; ${(err as Error).message}`);
  }
}

export class GitHubApplication {
  private readonly _config: AppConfig;
  private readonly _githubApiUrl: string | undefined;
  private _client: OctokitClient | null;
  private _metadata!: AppMetadata;

  constructor(privateKey: string, applicationId: string, baseApiUrl?: string) {
    this._config = {
      privateKey: new PrivateKey(_validateVariableValue('privateKey', privateKey)),
      id: _validateVariableValue('applicationId', applicationId),
    };

    this._githubApiUrl = baseApiUrl;
    this._client = null;
  }

  async connect(validSeconds?: number, proxy?: string): Promise<AppMetadata> {
    const secondsNow = Math.floor(Date.now() / 1000);
    const expireInSeconds = validSeconds || 60;

    const payload = {
      iat: secondsNow,
      exp: secondsNow + expireInSeconds,
      iss: this.id,
    };

    const token = jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
    this._client = getOctokit(token, this._githubApiUrl, proxy);

    try {
      const resp = await this.client.request('GET /app', {
        mediaType: {
          previews: ['machine-man'],
        },
      });

      if (resp.status === 200) {
        // Store the metadata for debug purposes
        this._metadata = resp.data as AppMetadata;
        return resp.data as AppMetadata;
      } else {
        throw new Error(`Failed to load application with id:${this.id}; ${resp.data}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Failed to load application')) {
        throw err;
      }
      throw new Error(
        `Failed to connect as application; status code: ${JSON.stringify((err as Record<string, unknown>).status)}\n${(err as Error).message}`
      );
    }
  }

  get githubApiBaseUrl(): string | undefined {
    return this._githubApiUrl;
  }

  get metadata(): AppMetadata {
    return this._metadata;
  }

  get client(): OctokitClient {
    const client = this._client;
    if (client === null) {
      throw new Error(
        'Application has not been initialized correctly, call connect() to connect to GitHub first.'
      );
    }
    return client;
  }

  get privateKey(): string {
    return this._config.privateKey.key;
  }

  get id(): string {
    return this._config.id;
  }

  get name(): string {
    return this._metadata.name;
  }

  async getApplicationInstallations(): Promise<Installation[]> {
    try {
      const resp = await this.client.request('GET /app/installations', {
        mediaType: {
          previews: ['machine-man'],
        },
      });

      if (resp.status === 200) {
        return resp.data as Installation[];
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unexpected status code')) {
        throw err;
      }
      throw new Error(`Failed to get application installations; ${(err as Error).message}`);
    }
  }

  async getRepositoryInstallation(owner: string, repo: string): Promise<Installation> {
    try {
      const resp = await this.client.rest.apps.getRepoInstallation({
        owner: owner,
        repo: repo,
      });

      if (resp.status === 200) {
        return resp.data as unknown as Installation;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unexpected status code')) {
        throw err;
      }
      throw new Error(
        `Failed to resolve installation of application on repository ${owner}/${repo}; ${(err as Error).message}`
      );
    }
  }

  async getOrganizationInstallation(org: string): Promise<Installation> {
    try {
      const resp = await this.client.rest.apps.getOrgInstallation({
        org: org,
      });

      if (resp.status === 200) {
        return resp.data as unknown as Installation;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unexpected status code')) {
        throw err;
      }
      throw new Error(
        `Failed to resolve installation of application on organization ${org}; ${(err as Error).message}`
      );
    }
  }

  async getInstallationAccessToken(
    installationId: number,
    permissions?: Record<string, string>
  ): Promise<AccessToken> {
    if (!installationId) {
      throw new Error('GitHub Application installation id must be provided');
    }

    const resolvedPermissions = permissions || {};
    const additional: Record<string, unknown> = {};
    if (Object.keys(resolvedPermissions).length > 0) {
      additional.permissions = resolvedPermissions;
    }

    try {
      const resp = await this.client.request(
        `POST /app/installations/${installationId}/access_tokens`,
        {
          mediaType: {
            previews: ['machine-man'],
          },
          ...additional,
        }
      );

      if (resp.status === 201) {
        return resp.data as AccessToken;
      }
      throw new Error(`Unexpected status code ${resp.status}; ${resp.data}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unexpected status code')) {
        throw err;
      }
      throw new Error(
        `Failed to get access token for application installation; ${(err as Error).message}`
      );
    }
  }
}

function getOctokit(token: string, baseApiUrl?: string, proxy?: string): OctokitClient {
  const baseUrl = getApiBaseUrl(baseApiUrl);

  const octokitOptions: Record<string, unknown> = {
    baseUrl: baseUrl,
  };
  const request: Record<string, unknown> = {
    agent: getProxyAgent(proxy, baseUrl),
    timeout: 5000,
  };
  octokitOptions.request = request;
  const client = github.getOctokit(token, octokitOptions);

  return client;
}

function _validateVariableValue(variableName: string, value: string | null | undefined): string {
  if (!value) {
    throw new Error(`A valid ${variableName} must be provided, was "${value}"`);
  }

  const result = `${value}`.trim();
  if (result.length === 0) {
    throw new Error(
      `${variableName} must be provided contained no valid characters other than whitespace`
    );
  }
  return result;
}

function getProxyAgent(
  proxy: string | undefined,
  baseUrl: string
): HttpsProxyAgent<string> | null {
  if (proxy) {
    // User has an explicit proxy set, use it
    core.info(`explicit proxy specified as '${proxy}'`);
    return new HttpsProxyAgent(proxy);
  } else {
    // When loading from the environment, also respect no_proxy settings
    const envProxy =
      process.env.http_proxy ||
      process.env.HTTP_PROXY ||
      process.env.https_proxy ||
      process.env.HTTPS_PROXY;

    if (envProxy) {
      core.info(`environment proxy specified as '${envProxy}'`);

      const noProxy = process.env.no_proxy || process.env.NO_PROXY;
      if (noProxy) {
        core.info(`environment no_proxy set as '${noProxy}'`);
        if (proxyExcluded(noProxy, baseUrl)) {
          core.info('environment proxy excluded from no_proxy settings');
        } else {
          core.info(`using proxy '${envProxy}' for GitHub API calls`);
          return new HttpsProxyAgent(envProxy);
        }
      }
    }
  }
  return null;
}

function proxyExcluded(noProxy: string, baseUrl: string): boolean {
  if (noProxy) {
    const noProxyHosts = noProxy.split(',').map((part) => part.trim());
    const baseUrlHost = new URL(baseUrl).host;

    core.debug(`noProxyHosts = ${JSON.stringify(noProxyHosts)}`);
    core.debug(`baseUrlHost = ${baseUrlHost}`);

    return noProxyHosts.includes(baseUrlHost);
  }
  return false;
}

function getApiBaseUrl(url?: string): string {
  return url || process.env['GITHUB_API_URL'] || 'https://api.github.com';
}
