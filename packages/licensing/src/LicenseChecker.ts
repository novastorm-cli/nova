import { createHash } from 'node:crypto';
import type { ILicenseChecker } from '@novastorm-ai/core';
import type { LicenseStatus, NovaConfig } from '@novastorm-ai/core';
import { TeamDetector } from './TeamDetector.js';

const FREE_DEV_LIMIT = 3;
const KEY_PATTERN = /^NOVA-([A-Z2-7]+)-([a-f0-9]{4})$/;

function computeChecksum(base32Body: string): string {
  return createHash('sha256').update(base32Body).digest('hex').slice(0, 4);
}

function validateKey(key: string): boolean {
  const match = KEY_PATTERN.exec(key);
  if (!match) return false;
  const [, body, checksum] = match;
  return computeChecksum(body) === checksum;
}

export class LicenseChecker implements ILicenseChecker {
  private teamDetector = new TeamDetector();

  async check(projectPath: string, _config: NovaConfig): Promise<LicenseStatus> {
    const teamInfo = await this.teamDetector.detect(projectPath);
    const devCount = teamInfo.devCount;

    if (devCount <= FREE_DEV_LIMIT) {
      return { valid: true, tier: 'free', devCount };
    }

    const key = _config.license?.key ?? process.env['NOVA_LICENSE_KEY'] ?? '';

    if (!key) {
      return {
        valid: false,
        tier: 'company',
        devCount,
        message:
          'Company license required: this project has more than 3 contributors. Set NOVA_LICENSE_KEY to continue.',
      };
    }

    if (!validateKey(key)) {
      return {
        valid: false,
        tier: 'company',
        devCount,
        message:
          'Invalid license key format. Expected NOVA-{BASE32}-{CHECKSUM}.',
      };
    }

    return { valid: true, tier: 'company', devCount };
  }
}
