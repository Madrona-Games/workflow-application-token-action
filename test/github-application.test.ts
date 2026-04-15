import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

// --- Mock setup ---

// Mock @actions/core to suppress logging
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  debug: vi.fn(),
}));

// Mock jsonwebtoken so we don't need a real RSA key for signing
vi.mock('jsonwebtoken', () => ({
  sign: vi.fn(() => 'mock-jwt-token'),
}));

// Build a mock Octokit client factory
function createMockOctokit() {
  return {
    request: vi.fn(),
    rest: {
      apps: {
        getRepoInstallation: vi.fn(),
        getOrgInstallation: vi.fn(),
        revokeInstallationAccessToken: vi.fn(),
      },
      repos: {
        get: vi.fn(),
      },
    },
  };
}

let mockOctokit = createMockOctokit();

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn((..._args: unknown[]) => mockOctokit),
}));

// --- Import modules under test (after mocks are hoisted) ---
import * as github from '@actions/github';
import * as gitHubApp from '../src/github-application';

// --- Test constants ---
const FAKE_PRIVATE_KEY =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAH\n-----END RSA PRIVATE KEY-----';
const FAKE_APP_ID = '12345';

const MOCK_APP_METADATA = {
  id: 12345,
  name: 'test-app',
  owner: { login: 'test-owner' },
  permissions: { issues: 'write', metadata: 'read' },
  installations_count: 2,
};

const MOCK_INSTALLATION = {
  id: 99999,
  permissions: { issues: 'write', metadata: 'read' },
};

const MOCK_ACCESS_TOKEN = {
  token: 'ghs_mock_installation_token',
  permissions: { issues: 'write', metadata: 'read' },
};

const MOCK_REPO_DATA = {
  owner: { login: 'test-owner' },
  name: 'test-repo',
};

// --- Helpers ---

/** Configure the mock Octokit so that `create()` / `connect()` succeeds */
function setupConnectMock() {
  (mockOctokit.request as Mock).mockImplementation(async (route: string) => {
    if (route === 'GET /app') {
      return { status: 200, data: MOCK_APP_METADATA };
    }
    if (route === 'GET /app/installations') {
      return { status: 200, data: [MOCK_INSTALLATION] };
    }
    if (route.startsWith('POST /app/installations/')) {
      return { status: 201, data: MOCK_ACCESS_TOKEN };
    }
    throw new Error(`Unexpected request route: ${route}`);
  });
}

// --- Tests ---

describe('GitHubApplication', () => {
  beforeEach(() => {
    // Reset all mock state and recreate the Octokit mock
    vi.clearAllMocks();
    mockOctokit = createMockOctokit();

    // Make @actions/github.getOctokit return the fresh mock
    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as unknown as ReturnType<typeof github.getOctokit>);
  });

  // ---- Validation tests ----

  describe('creation with invalid private keys', () => {
    it('should fail on an empty private key', async () => {
      await expectCreateToFail('', FAKE_APP_ID, 'privateKey');
    });

    it('should fail on a private key consisting of whitespace characters', async () => {
      await expectCreateToFail(' \n \r\n ', FAKE_APP_ID, 'privateKey');
    });

    it('should fail a null private key', async () => {
      await expectCreateToFail(null as unknown as string, FAKE_APP_ID, 'privateKey');
    });

    it('should fail on an undefined private key', async () => {
      await expectCreateToFail(undefined as unknown as string, FAKE_APP_ID, 'privateKey');
    });
  });

  describe('creation with invalid application id', () => {
    it('should fail on an empty application id', async () => {
      await expectCreateToFail(FAKE_PRIVATE_KEY, '', 'applicationId');
    });

    it('should fail on a application id consisting of whitespace characters', async () => {
      await expectCreateToFail(FAKE_PRIVATE_KEY, ' \n \r\n ', 'applicationId');
    });

    it('should fail a null application id', async () => {
      await expectCreateToFail(FAKE_PRIVATE_KEY, null as unknown as string, 'applicationId');
    });

    it('should fail on an undefined application id', async () => {
      await expectCreateToFail(
        FAKE_PRIVATE_KEY,
        undefined as unknown as string,
        'applicationId'
      );
    });
  });

  async function expectCreateToFail(
    privateKey: string,
    applicationId: string,
    expectedSubstring: string
  ): Promise<void> {
    try {
      setupConnectMock();
      await gitHubApp.create(privateKey, applicationId);
      expect.fail('Should have thrown an error');
    } catch (err) {
      expect((err as Error).message).toContain(expectedSubstring);
    }
  }

  // ---- Installed Application tests (fully mocked) ----

  describe('Installed Application - GitHub.com', () => {
    let app: Awaited<ReturnType<typeof gitHubApp.create>> | null = null;

    beforeEach(async () => {
      setupConnectMock();
      app = await gitHubApp.create(FAKE_PRIVATE_KEY, FAKE_APP_ID);
    });

    it('should connect to GitHub.com', () => {
      const appData = app!.metadata;

      expect(appData).toHaveProperty('id', MOCK_APP_METADATA.id);
      expect(appData).toHaveProperty('owner');
      expect(appData).toHaveProperty('name');
      expect(appData).toHaveProperty('permissions');
      expect(appData).toHaveProperty('installations_count');
    });

    it('should be able to list application installations', async () => {
      const data = await app!.getApplicationInstallations();

      expect(data).toBeInstanceOf(Array);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
    });

    it('should be able to get installation for a repository', async () => {
      (mockOctokit.rest.apps.getRepoInstallation as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_INSTALLATION,
      });

      const data = await app!.getRepositoryInstallation('test-owner', 'test-repo');

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('permissions');
    });

    it('should be able to get installation for an organization', async () => {
      (mockOctokit.rest.apps.getOrgInstallation as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_INSTALLATION,
      });

      const data = await app!.getOrganizationInstallation('test-org');

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('permissions');
    });

    it('should fetch the requested permissions (read)', async () => {
      (mockOctokit.rest.apps.getOrgInstallation as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_INSTALLATION,
      });

      const data = await app!.getOrganizationInstallation('test-org');

      // Mock the access token request to return read permissions
      (mockOctokit.request as Mock).mockResolvedValueOnce({
        status: 201,
        data: {
          token: 'ghs_read_token',
          permissions: { issues: 'read', metadata: 'read' },
        },
      });

      const accessToken = await app!.getInstallationAccessToken(data.id, {
        issues: 'read',
      });

      expect(accessToken).toHaveProperty('permissions');
      expect(accessToken.permissions).toEqual({
        issues: 'read',
        metadata: 'read',
      });
    });

    it('should fetch the requested permissions (write)', async () => {
      (mockOctokit.rest.apps.getOrgInstallation as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_INSTALLATION,
      });

      const data = await app!.getOrganizationInstallation('test-org');

      (mockOctokit.request as Mock).mockResolvedValueOnce({
        status: 201,
        data: {
          token: 'ghs_write_token',
          permissions: { issues: 'write', metadata: 'read' },
        },
      });

      const accessToken = await app!.getInstallationAccessToken(data.id, {
        issues: 'write',
      });

      expect(accessToken).toHaveProperty('permissions');
      expect(accessToken.permissions).toEqual({
        issues: 'write',
        metadata: 'read',
      });
    });

    it('should be able to get access token for a repository installation', async () => {
      (mockOctokit.rest.apps.getRepoInstallation as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_INSTALLATION,
      });

      const repoInstall = await app!.getRepositoryInstallation('test-owner', 'test-repo');

      (mockOctokit.request as Mock).mockResolvedValueOnce({
        status: 201,
        data: MOCK_ACCESS_TOKEN,
      });

      const accessToken = await app!.getInstallationAccessToken(repoInstall.id);
      expect(accessToken).toHaveProperty('token');

      // Verify the token can be used (mock repos.get)
      (mockOctokit.rest.repos.get as Mock).mockResolvedValue({
        status: 200,
        data: MOCK_REPO_DATA,
      });

      const client = github.getOctokit(accessToken.token);
      const repo = await (client as unknown as typeof mockOctokit).rest.repos.get({
        owner: 'test-owner',
        repo: 'test-repo',
      });

      expect(repo).toHaveProperty('status', 200);
      expect(repo).toHaveProperty('data');
      expect(repo.data).toHaveProperty('name', 'test-repo');
    });

    describe('Using proxy server', () => {
      describe('Installed Application - GitHub.com', { timeout: 10_000 }, () => {
        beforeEach(async () => {
          setupConnectMock();
          app = await gitHubApp.create(
            FAKE_PRIVATE_KEY,
            FAKE_APP_ID,
            undefined,
            null,
            'http://mock-proxy:3128'
          );
        });

        it('should be able to get access token for a repository installation', async () => {
          (mockOctokit.rest.apps.getRepoInstallation as Mock).mockResolvedValue({
            status: 200,
            data: MOCK_INSTALLATION,
          });

          const repoInstall = await app!.getRepositoryInstallation('test-owner', 'test-repo');

          (mockOctokit.request as Mock).mockResolvedValueOnce({
            status: 201,
            data: MOCK_ACCESS_TOKEN,
          });

          const accessToken = await app!.getInstallationAccessToken(repoInstall.id);
          expect(accessToken).toHaveProperty('token');

          (mockOctokit.rest.repos.get as Mock).mockResolvedValue({
            status: 200,
            data: MOCK_REPO_DATA,
          });

          const client = github.getOctokit(accessToken.token);
          const repo = await (client as unknown as typeof mockOctokit).rest.repos.get({
            owner: 'test-owner',
            repo: 'test-repo',
          });

          expect(repo).toHaveProperty('status', 200);
          expect(repo).toHaveProperty('data');
          expect(repo.data).toHaveProperty('name', 'test-repo');
        });
      });
    });

    describe('Application token revocation', () => {
      let testToken: string;

      beforeEach(async () => {
        (mockOctokit.rest.apps.getRepoInstallation as Mock).mockResolvedValue({
          status: 200,
          data: MOCK_INSTALLATION,
        });

        const repoInstall = await app!.getRepositoryInstallation('test-owner', 'test-repo');

        (mockOctokit.request as Mock).mockResolvedValueOnce({
          status: 201,
          data: MOCK_ACCESS_TOKEN,
        });

        const accessToken = await app!.getInstallationAccessToken(repoInstall.id);
        expect(accessToken).toHaveProperty('token');
        testToken = accessToken.token;
      });

      it('should be able to revoke a valid application token', async () => {
        // First call: repos.get succeeds (token is valid)
        (mockOctokit.rest.repos.get as Mock).mockResolvedValueOnce({
          status: 200,
          data: MOCK_REPO_DATA,
        });

        const client = github.getOctokit(testToken);
        const repo = await (client as unknown as typeof mockOctokit).rest.repos.get({
          owner: 'test-owner',
          repo: 'test-repo',
        });
        expect(repo).toHaveProperty('status', 200);

        // Revoke the token
        (mockOctokit.rest.apps.revokeInstallationAccessToken as Mock).mockResolvedValue({
          status: 204,
          data: undefined,
        });

        const revoked = await gitHubApp.revokeAccessToken(testToken);
        expect(revoked).toBe(true);

        // After revocation: repos.get fails with Bad credentials
        (mockOctokit.rest.repos.get as Mock).mockRejectedValueOnce(
          new Error('Bad credentials')
        );

        try {
          const client2 = github.getOctokit(testToken);
          await (client2 as unknown as typeof mockOctokit).rest.repos.get({
            owner: 'test-owner',
            repo: 'test-repo',
          });
          expect.fail('The token should no longer be valid so should not get here.');
        } catch (err) {
          expect((err as Error).message).toContain('Bad credentials');
        }
      });
    });
  });
});
