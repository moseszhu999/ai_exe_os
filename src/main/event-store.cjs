const { randomUUID } = require('node:crypto');
const { mkdirSync, appendFileSync, readFileSync, existsSync } = require('node:fs');
const { dirname } = require('node:path');

class JsonlEventStore {
  constructor(filePath) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  append(event) {
    if (!event || !event.type) throw new TypeError('Event type is required');
    const stored = Object.freeze({
      id: event.id || randomUUID(),
      occurredAt: event.occurredAt || new Date().toISOString(),
      ...event,
    });
    appendFileSync(this.filePath, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 });
    return stored;
  }

  readAll() {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

module.exports = { JsonlEventStore };
