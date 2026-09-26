import { createFixtures } from './fixtures.js';
import { readJson, writeJson } from './persistence.js';

export class StateStore {
  constructor(path = null) {
    this.path = path;
    this.data = readJson(path, () => createFixtures());
    for (const key of ['pairings', 'storeCarts', 'checkoutSessions', 'purchases', 'ledger', 'events']) this.data[key] ||= [];
  }
  save() { writeJson(this.path, this.data); }
  resetSamples() {
    const previous = this.data;
    const registered = new Set(previous.users.filter(user => !user.sample).map(user => user.id));
    const next = createFixtures();
    for (const [key, values] of Object.entries(previous)) {
      if (!Array.isArray(values)) continue;
      const retained = values.filter(value => key === 'users' ? registered.has(value.id) : registered.has(value.userId));
      next[key] = [...(next[key] || []), ...retained];
    }
    next.pairings = [];
    this.data = next; this.save(); return this.data;
  }
}
