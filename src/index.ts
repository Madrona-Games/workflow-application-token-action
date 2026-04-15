import * as core from '@actions/core';
import * as githubApplication from './github-application';

async function run(): Promise<void> {
  let app: Awaited<ReturnType<typeof githubApplication.create>> | undefined;

  try {
    const privateKey = getRequiredInputValue('application_private_key');
    const applicationId = getRequiredInputValue('application_id');
    const githubApiBaseUrl = core.getInput('github_api_base_url');
    const httpsProxy = core.getInput('https_proxy');

    app = await githubApplication.create(privateKey, applicationId, githubApiBaseUrl, null, httpsProxy);
  } catch (err) {
    fail(err, 'Failed to initialize GitHub Application connection using provided id and private key');
  }

  if (app) {
    core.info(`Found GitHub Application: ${app.name}`);

    try {
      const userSpecifiedOrganization = core.getInput('organization');
      const repository = process.env['GITHUB_REPOSITORY'] || '';
      const repoParts = repository.split('/');

      let installationId: number | undefined;

      if (userSpecifiedOrganization) {
        core.info(`Obtaining application installation for organization: ${userSpecifiedOrganization}`);

        // use the organization specified to get the installation
        const installation = await app.getOrganizationInstallation(userSpecifiedOrganization);
        if (installation.id) {
          installationId = installation.id;
        } else {
          fail(null, `GitHub Application is not installed on the specified organization: ${userSpecifiedOrganization}`);
        }
      } else {
        core.info(`Obtaining application installation for repository: ${repository}`);

        // fallback to getting a repository installation
        const installation = await app.getRepositoryInstallation(repoParts[0], repoParts[1]);
        if (installation.id) {
          installationId = installation.id;
        } else {
          fail(null, `GitHub Application is not installed on repository: ${repository}`);
        }
      }

      if (installationId) {
        const permissions: Record<string, string> = {};
        // Build up the list of requested permissions
        const permissionInput = core.getInput('permissions');
        if (permissionInput) {
          for (const p of permissionInput.split(',')) {
            const [pName, pLevel] = p.split(':', 2);
            permissions[pName.trim()] = pLevel.trim();
          }
          core.info(`Requesting limitation on GitHub Application permissions to only: ${JSON.stringify(permissions)}`);
        }

        const accessToken = await app.getInstallationAccessToken(installationId, permissions);

        // Register the secret to mask it in the output
        core.setSecret(accessToken.token);
        core.setOutput('token', accessToken.token);
        core.info(JSON.stringify(accessToken));
        core.info('Successfully generated an access token for application.');

        if (core.getBooleanInput('revoke_token')) {
          // Store the token for post state invalidation of it once the job is complete
          core.saveState('token', accessToken.token);
        }
      } else {
        fail('No installation of the specified GitHub application was able to be retrieved.');
      }
    } catch (err) {
      fail(err);
    }
  }
}

run();

function fail(err: unknown, message?: string): void {
  if (err) {
    core.error(err instanceof Error ? err : JSON.stringify(err));
  }

  if (message) {
    core.setFailed(message);
  } else {
    core.setFailed(err instanceof Error ? err.message : JSON.stringify(err));
  }
}

function getRequiredInputValue(key: string): string {
  return core.getInput(key, { required: true });
}
