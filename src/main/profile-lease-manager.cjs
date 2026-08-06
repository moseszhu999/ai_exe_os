const { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } = require('node:fs');
const { join } = require('node:path');

class ProfileLeaseManager {
  constructor({ processIsAlive = defaultProcessIsAlive } = {}) {
    this.processIsAlive = processIsAlive;
  }

  leasePath(profilePath) {
    return join(profilePath, '.ai-exe-os-profile-lock.json');
  }

  read(profilePath) {
    const path = this.leasePath(profilePath);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid profile lease at ${path}: ${error.message}`);
    }
  }

  acquire({ profilePath, workerId, processId = process.pid, now = new Date().toISOString() }) {
    mkdirSync(profilePath, { recursive: true });
    const existing = this.read(profilePath);

    if (existing && existing.workerId === workerId && existing.processId === processId) {
      return existing;
    }
    if (existing && this.processIsAlive(existing.processId)) {
      throw new Error(`Profile is already leased by worker ${existing.workerId} (pid ${existing.processId})`);
    }

    const lease = { profilePath, workerId, processId, acquiredAt: now, heartbeatAt: now };
    writeFileSync(this.leasePath(profilePath), `${JSON.stringify(lease, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
      mode: 0o600,
    });
    return lease;
  }

  heartbeat({ profilePath, workerId, now = new Date().toISOString() }) {
    const existing = this.read(profilePath);
    if (!existing || existing.workerId !== workerId) {
      throw new Error(`Worker ${workerId} does not own profile ${profilePath}`);
    }
    const next = { ...existing, heartbeatAt: now };
    writeFileSync(this.leasePath(profilePath), `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return next;
  }

  release({ profilePath, workerId }) {
    const existing = this.read(profilePath);
    if (!existing) return false;
    if (existing.workerId !== workerId) {
      throw new Error(`Worker ${workerId} cannot release profile owned by ${existing.workerId}`);
    }
    unlinkSync(this.leasePath(profilePath));
    return true;
  }
}

function defaultProcessIsAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

module.exports = { ProfileLeaseManager, defaultProcessIsAlive };
