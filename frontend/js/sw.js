'use strict';

/**
 * Offline-first service worker.
 * - Static assets ("/", "/project.html", "/js/*", "/css/*") are cached and
 *   served from cache when the network is unreachable.
 * - Projects/Modules are mirrored into IndexedDB. GET requests fall back to
 *   that copy when offline; mutations are applied to the copy immediately
 *   and queued (SyncQueue) to be replayed against the server once it's
 *   reachable again.
 */

// ---------------------------------------------------------------------------
// IDs for records created while offline (no server id exists yet)
// ---------------------------------------------------------------------------
class IdGenerator {
  static PREFIX = 'temp-';

  static create() {
    return `${this.PREFIX}${self.crypto.randomUUID()}`;
  }

  static isTemp(id) {
    return typeof id === 'string' && id.startsWith(this.PREFIX);
  }

  /** Real ids from the server are numeric; temp ids stay as their string form. */
  static normalize(id) {
    return this.isTemp(id) ? id : parseInt(id, 10);
  }
}

// ---------------------------------------------------------------------------
// Small helper for building JSON Response objects
// ---------------------------------------------------------------------------
class JsonResponse {
  static ok(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ---------------------------------------------------------------------------
// Generic promise-based IndexedDB wrapper
// ---------------------------------------------------------------------------
class Database {
  static NAME = 'offline-store';
  static VERSION = 1;
  static #dbPromise = null;

  static open() {
    if (!this.#dbPromise) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.NAME, this.VERSION);
        request.onupgradeneeded = () => this.#createStores(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.#dbPromise;
  }

  static #createStores(db) {
    if (!db.objectStoreNames.contains('projects')) {
      db.createObjectStore('projects', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('modules')) {
      const modules = db.createObjectStore('modules', { keyPath: 'id' });
      modules.createIndex('by_project', 'project_id');
    }

    if (!db.objectStoreNames.contains('syncQueue')) {
      db.createObjectStore('syncQueue', {
        keyPath: 'queueId',
        autoIncrement: true,
      });
    }
  }

  static async #run(storeName, mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static get(store, key) {
    return this.#run(store, 'readonly', s => s.get(key));
  }

  static getAll(store) {
    return this.#run(store, 'readonly', s => s.getAll());
  }

  static getAllByIndex(store, index, key) {
    return this.#run(store, 'readonly', s => s.index(index).getAll(key));
  }

  static put(store, value) {
    return this.#run(store, 'readwrite', s => s.put(value));
  }

  static delete(store, key) {
    return this.#run(store, 'readwrite', s => s.delete(key));
  }
}

class NetworkState {
  static online = true;
  static lastCheck = 0;
  static CHECK_INTERVAL = 4000;

  static async notifyClients(is_online) {
    const clients = await self.clients.matchAll();
    for (const client of clients) {
      client.postMessage({ type: 'NETWORK_STATUS', online: is_online });
    }
  }

  static async check() {
    const now = Date.now();
    if (now - this.lastCheck < this.CHECK_INTERVAL) {
      this.notifyClients(this.online);
      return this.online;
    }

    this.lastCheck = now;

    try {
      const res = await fetch('/ping', { method: 'HEAD', cache: 'no-store' });
      this.online = res.ok;
    } catch {
      this.online = false;
    }
    this.notifyClients(this.online);
    return this.online;
  }
}

// ---------------------------------------------------------------------------
// The local copy of Projects and Modules
// ---------------------------------------------------------------------------
class LocalStore {
  static PROJECTS = 'projects';
  static MODULES = 'modules';

  static getAllProjects() {
    return Database.getAll(this.PROJECTS);
  }

  static getProject(projectId) {
    return Database.get(this.PROJECTS, IdGenerator.normalize(projectId));
  }

  static putProject(project) {
    return Database.put(this.PROJECTS, project);
  }

  static deleteProject(projectId) {
    return Database.delete(this.PROJECTS, IdGenerator.normalize(projectId));
  }

  static getModulesByProject(projectId) {
    return Database.getAllByIndex(this.MODULES, 'by_project', IdGenerator.normalize(projectId));
  }

  static putModule(module) {
    return Database.put(this.MODULES, module);
  }

  static deleteModule(moduleId) {
    return Database.delete(this.MODULES, moduleId);
  }

  static buildTempProject({ name, description, color }) {
    const now = new Date().toISOString();
    return {
      id: IdGenerator.create(),
      name,
      description,
      color,
      created_at: now,
      updated_at: now,
    };
  }

  static async buildTempModule(projectId, { data, title, module_type }) {
    projectId = IdGenerator.normalize(projectId);
    const now = new Date().toISOString();
    const siblings = await this.getModulesByProject(projectId);
    const position = siblings.length
      ? Math.max(...siblings.map(m => m.position)) + 1
      : 0;

    return {
      id: IdGenerator.create(),
      project_id: projectId,
      data,
      title,
      module_type,
      position,
      created_at: now,
      updated_at: now,
    };
  }

  // Merges a server list into the local copy. Records with a pending queue
  // entry keep their local (unsynced) value instead of being overwritten,
  // since the server doesn't know about that change yet.
  static async reconcileProjects(serverProjects) {
    const pending = await SyncManager.pendingIds('PROJECT');
    const serverIds = new Set(serverProjects.map(p => p.id));
    const local = await this.getAllProjects();

    for (const project of local) {
      if (!serverIds.has(project.id) && !pending.has(project.id)) {
        await this.deleteProject(project.id);
      }
    }
    for (const project of serverProjects) {
      if (!pending.has(project.id)) await this.putProject(project);
    }
  }

  static async reconcileModules(projectId, serverModules) {
    projectId = IdGenerator.normalize(projectId);
    const pending = await SyncManager.pendingIds('MODULE');
    const serverIds = new Set(serverModules.map(m => m.id));
    const local = await this.getModulesByProject(projectId);

    for (const module of local) {
      if (!serverIds.has(module.id) && !pending.has(module.id)) {
        await this.deleteModule(module.id);
      }
    }
    for (const module of serverModules) {
      if (!pending.has(module.id)) await this.putModule(module);
    }
  }
}

// ---------------------------------------------------------------------------
// The list of changes made offline, waiting to be sent to the server
// ---------------------------------------------------------------------------
class SyncQueue {
  static STORE = 'syncQueue';

  static enqueue(entry) {
    return Database.put(this.STORE, { ...entry, timestamp: Date.now() });
  }

  static getAll() {
    return Database.getAll(this.STORE);
  }

  static remove(queueId) {
    return Database.delete(this.STORE, queueId);
  }

  // Drops queued entries about an entity that's just been deleted - any
  // edits still queued for it are moot.
  static async discardFor(entityId) {
    const entries = await this.getAll();
    for (const entry of entries) {
      if (entry.entityId === entityId || entry.projectId === entityId) {
        await this.remove(entry.queueId);
      }
    }
  }

  // Once a queued CREATE syncs, its temp id becomes a real one - rewrite it
  // everywhere it's still referenced by other queued entries.
  static async remapId(tempId, realId) {
    const entries = await this.getAll();
    for (const entry of entries) {
      let changed = false;
      if (entry.entityId === tempId) {
        entry.entityId = realId;
        changed = true;
      }
      if (entry.projectId === tempId) {
        entry.projectId = realId;
        changed = true;
      }
      if (entry.payload?.ordered_ids?.includes(tempId)) {
        entry.payload.ordered_ids = entry.payload.ordered_ids.map(id => (id === tempId ? realId : id));
        changed = true;
      }
      if (changed) await Database.put(this.STORE, entry);
    }
  }
}

// ---------------------------------------------------------------------------
// Turns a queue entry back into the real API request it represents
// ---------------------------------------------------------------------------
class Endpoints {
  static send(entry) {
    switch (entry.op) {
      case 'CREATE_PROJECT':
        return fetch('/api/projects/', this.#json('POST', entry.payload));
      case 'DELETE_PROJECT':
        return fetch(`/api/projects/${entry.entityId}`, { method: 'DELETE' });
      case 'CREATE_MODULE':
        return fetch(`/api/projects/${entry.projectId}/modules`, this.#json('POST', entry.payload));
      case 'UPDATE_MODULE':
        return fetch(`/api/projects/modules/${entry.entityId}`, this.#json('PATCH', entry.payload));
      case 'DELETE_MODULE':
        return fetch(`/api/projects/modules/${entry.entityId}`, { method: 'DELETE' });
      case 'REORDER_MODULES':
        return fetch(`/api/projects/${entry.projectId}/modules/reorder`, this.#json('POST', entry.payload));
      default:
        return Promise.reject(new Error(`Unknown queued operation: ${entry.op}`));
    }
  }

  static #json(method, body) {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
}

// ---------------------------------------------------------------------------
// Replays the SyncQueue against the server once it's reachable again
// ---------------------------------------------------------------------------
class SyncManager {
  static SYNC_TAG = 'flush-mutation-queue';
  static #flushing = false;

  static async pendingIds(kind) {
    const entries = await SyncQueue.getAll();
    const ids = new Set();
    for (const entry of entries) {
      if (entry.op.endsWith(kind)) ids.add(entry.entityId);
    }
    return ids;
  }

  static async registerBackgroundSync() {
    try {
      if ('sync' in self.registration) await self.registration.sync.register(this.SYNC_TAG);
    } catch {
      // Background Sync isn't supported everywhere (e.g. Safari); the
      // 'online' listener registered below covers those browsers instead.
    }
  }

  static async flush() {
    if (this.#flushing || self.navigator.onLine === false) return;
    this.#flushing = true;
    try {
      const entries = (await SyncQueue.getAll()).sort((a, b) => a.queueId - b.queueId);
      for (const entry of entries) {
        const sent = await this.#send(entry);
        if (!sent) break; // network's gone again - stop and keep the rest queued
        await SyncQueue.remove(entry.queueId);
      }
    } finally {
      this.#flushing = false;
    }
  }

  static async #send(entry) {
    let response;
    try {
      response = await Endpoints.send(entry);
    } catch {
      return false; // network error - not actually online
    }
    // The server rejected this change outright (e.g. validation error).
    // There's no conflict-resolution spec to follow, so it's dropped rather
    // than blocking every later queued change behind it.
    if (response.ok && (entry.op === 'CREATE_PROJECT' || entry.op === 'CREATE_MODULE')) {
      await this.#adoptRealId(entry, await response.json());
    }
    return true;
  }

  static async #adoptRealId(entry, real) {
    const tempId = entry.entityId;
    if (entry.op === 'CREATE_PROJECT') {
      await LocalStore.deleteProject(tempId);
      await LocalStore.putProject(real);
      await SyncQueue.remapId(tempId, real.id);
    } else {
      await LocalStore.deleteModule(tempId);
      await LocalStore.putModule(real);
      await SyncQueue.remapId(tempId, real.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Caches "/", "/project.html", "/js/*" and "/css/*"
// ---------------------------------------------------------------------------
class StaticAssetHandler {
  static CACHE_NAME = 'static-assets-v1';
  static PRECACHE_URLS = ['/', '/project.html'];

  static matches(pathname) {
    return (
      pathname === '/' ||
      pathname === '/project.html' ||
      pathname.startsWith('/js/') ||
      pathname.startsWith('/css/')
    );
  }

  static async precache() {
    const cache = await caches.open(this.CACHE_NAME);
    try {
      await cache.addAll(this.PRECACHE_URLS);
    } catch (err) {
      console.warn('sw: precache failed', err);
    }
  }

  // Network-first: keeps the cache fresh while online, falls back to
  // whatever was last cached when the network is unreachable.
  static async handle(request) {
    const cache = await caches.open(this.CACHE_NAME);
    if (NetworkState.online) {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (err) {
        const cached = await cache.match(request);
        NetworkState.online = false;
        NetworkState.notifyClients(false);
        if (cached) return cached;
        throw err;
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;
  }
}

// ---------------------------------------------------------------------------
// Routes /api/* requests: tries the network first, falls back to the local
// copy (and queues the change) when it's unreachable.
// ---------------------------------------------------------------------------
class ApiRouter {
  static ROUTES = [
    { method: 'GET', pattern: /^\/api\/projects\/([^/]+)$/, handler: 'getProject' },
    { method: 'GET', pattern: /^\/api\/projects\/$/, handler: 'listProjects' },
    { method: 'POST', pattern: /^\/api\/projects\/$/, handler: 'createProject' },
    { method: 'DELETE', pattern: /^\/api\/projects\/([^/]+)$/, handler: 'deleteProject' },
    { method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/modules\/reorder$/, handler: 'reorderModules' },
    { method: 'GET', pattern: /^\/api\/projects\/([^/]+)\/modules$/, handler: 'listModules' },
    { method: 'POST', pattern: /^\/api\/projects\/([^/]+)\/modules$/, handler: 'createModule' },
    { method: 'PATCH', pattern: /^\/api\/projects\/modules\/([^/]+)$/, handler: 'updateModule' },
    { method: 'DELETE', pattern: /^\/api\/projects\/modules\/([^/]+)$/, handler: 'deleteModule' },
  ];

  static async handle(request, pathname) {
    const route = this.ROUTES.find(r => r.method === request.method && r.pattern.test(pathname));
    if (!route) return fetch(request);

    await SyncManager.flush(); // send anything still queued before this new request
    const [, param] = pathname.match(route.pattern);
    return this[route.handler](request, param);
  }

  // fetch() rejects on a real network error but resolves (with an error
  // status) on an application error - only the former means "go offline".
  static async #tryFetch(request) {
    if (NetworkState.online) {
      try {
        return await fetch(request);
      } catch {
        NetworkState.online = false;
        NetworkState.notifyClients(false);
        return null;
      }
    }
    return null;
  }

  // --- Projects -------------------------------------------------------

  static async listProjects(request) {
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await LocalStore.reconcileProjects(await response.clone().json());
      return response;
    }
    return JsonResponse.ok(await LocalStore.getAllProjects());
  }

  static async getProject(request, projectId) {
    const response = await this.#tryFetch(request);
    if (response) return response;
    const project = await LocalStore.getProject(projectId);
    return project ? JsonResponse.ok(project) : JsonResponse.ok({ error: 'Not found' }, 404);
  }

  static async createProject(request) {
    const body = await request.clone().json();
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await LocalStore.putProject(await response.clone().json());
      return response;
    }
    const project = LocalStore.buildTempProject(body);
    await LocalStore.putProject(project);
    await SyncQueue.enqueue({ op: 'CREATE_PROJECT', entityId: project.id, payload: body });
    await SyncManager.registerBackgroundSync();
    return JsonResponse.ok(project, 201);
  }

  static async deleteProject(request, projectId) {
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await this.#purgeProject(projectId);
      return response;
    }
    await this.#purgeProject(projectId);
    if (!IdGenerator.isTemp(projectId)) {
      await SyncQueue.enqueue({ op: 'DELETE_PROJECT', entityId: projectId, payload: null });
      await SyncManager.registerBackgroundSync();
    }
    return JsonResponse.ok({ status: 'ok' });
  }

  // Removing a project removes its modules too (mirrors the server cascade).
  static async #purgeProject(projectId) {
    await LocalStore.deleteProject(projectId);
    const modules = await LocalStore.getModulesByProject(projectId);
    for (const module of modules) await LocalStore.deleteModule(module.id);
    await SyncQueue.discardFor(projectId);
  }

  // --- Modules ----------------------------------------------------------

  static async listModules(request, projectId) {
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await LocalStore.reconcileModules(projectId, await response.clone().json());
      return response;
    }
    const data = await LocalStore.getModulesByProject(projectId);
    return JsonResponse.ok(data);
  }

  static async createModule(request, projectId) {
    const body = await request.clone().json();
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await LocalStore.putModule(await response.clone().json());
      return response;
    }
    const module = await LocalStore.buildTempModule(projectId, body);
    await LocalStore.putModule(module);
    await SyncQueue.enqueue({ op: 'CREATE_MODULE', entityId: module.id, projectId: IdGenerator.normalize(projectId), payload: body });
    await SyncManager.registerBackgroundSync();
    return JsonResponse.ok(module, 201);
  }

  static async updateModule(request, moduleId) {
    const body = await request.clone().json();
    const data = body.data;
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await this.#patchModule(moduleId, data);
      return response;
    }
    const module = await this.#patchModule(moduleId, data);
    await SyncQueue.enqueue({ op: 'UPDATE_MODULE', entityId: moduleId, payload: body });
    await SyncManager.registerBackgroundSync();
    return JsonResponse.ok(module ?? { id: moduleId, data });
  }

  static async #patchModule(moduleId, data) {
    const module = await Database.get(LocalStore.MODULES, moduleId);
    if (!module) return null;
    module.data = data;
    module.updated_at = new Date().toISOString();
    await LocalStore.putModule(module);
    return module;
  }

  static async deleteModule(request, moduleId) {
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await this.#purgeModule(moduleId);
      return response;
    }
    await this.#purgeModule(moduleId);
    if (!IdGenerator.isTemp(moduleId)) {
      await SyncQueue.enqueue({ op: 'DELETE_MODULE', entityId: moduleId, payload: null });
      await SyncManager.registerBackgroundSync();
    }
    return JsonResponse.ok({ status: 'ok' });
  }

  static async #purgeModule(moduleId) {
    await LocalStore.deleteModule(moduleId);
    await SyncQueue.discardFor(moduleId);
  }

  static async reorderModules(request, projectId) {
    const body = await request.clone().json();
    const response = await this.#tryFetch(request);
    if (response) {
      if (response.ok) await this.#applyOrder(body.ordered_ids);
      return response;
    }
    await this.#applyOrder(body.ordered_ids);
    await SyncQueue.enqueue({ op: 'REORDER_MODULES', projectId: IdGenerator.normalize(projectId), payload: body });
    await SyncManager.registerBackgroundSync();
    return JsonResponse.ok({ status: 'ok' });
  }

  static async #applyOrder(orderedIds) {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      const module = await Database.get(LocalStore.MODULES, orderedIds[i]);
      if (!module) continue;
      module.position = i;
      module.updated_at = now;
      await LocalStore.putModule(module);
    }
  }
}

// ---------------------------------------------------------------------------
// Service worker lifecycle
// ---------------------------------------------------------------------------
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(StaticAssetHandler.precache());
  setInterval(() => NetworkState.check(), 5000);
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.filter(name => name !== StaticAssetHandler.CACHE_NAME).map(name => caches.delete(name))
    );
    await self.clients.claim();
    await SyncManager.flush();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    setTimeout(() => NetworkState.notifyClients(NetworkState.online), 400);
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(ApiRouter.handle(event.request, url.pathname));
  } else if (StaticAssetHandler.matches(url.pathname)) {
    event.respondWith(StaticAssetHandler.handle(event.request));
  }
});

self.addEventListener('online', () => SyncManager.flush());

self.addEventListener('sync', event => {
  if (event.tag === SyncManager.SYNC_TAG) event.waitUntil(SyncManager.flush());
});
