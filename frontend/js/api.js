/**
 * api.js
 * Thin wrapper around fetch. All network calls go through here so
 * the rest of the code never touches URLs or headers directly.
 *
 * Offline behaviour: the service worker (sw.js) intercepts /api/* requests
 * directly and queues mutations when the network is unreachable, so this
 * class doesn't need its own offline queue.
 */

const BASE = "/api";

class ApiClient {
    // -----------------------------------------------------------------------
    // Projects
    // -----------------------------------------------------------------------

    async getProjects() {
        return this._get("/projects/");
    }

    async getProject(id) {
        return this._get(`/projects/${id}`);
    }

    async createProject(payload) {
        return this._post("/projects/", payload);
    }

    async updateProject(id, payload) {
        return this._patch(`/projects/${id}`, payload);
    }

    async deleteProject(id) {
        return this._delete(`/projects/${id}`);
    }

    async exportProject(id) {
        return this._get(`/projects/${id}/export`);
    }

    async importProject(payload) {
        return this._post("/projects/import", payload);
    }

    // -----------------------------------------------------------------------
    // Modules
    // -----------------------------------------------------------------------

    async getModules(projectId) {
        return this._get(`/projects/${projectId}/modules`);
    }

    async createModule(projectId, payload) {
        return this._post(`/projects/${projectId}/modules`, payload);
    }

    async reorderModules(projectId, orderedIds) {
        return this._post(`/projects/${projectId}/modules/reorder`, { ordered_ids: orderedIds });
    }

    async updateModule(moduleId, payload) {
        return this._patch(`/projects/modules/${moduleId}`, payload);
    }

    async deleteModule(moduleId) {
        return this._delete(`/projects/modules/${moduleId}`);
    }

    async exportModule(moduleId) {
        return this._get(`/projects/modules/${moduleId}/export`);
    }

    async importModule(projectId, payload) {
        return this._post(`/projects/${projectId}/modules/import`, payload);
    }

    // -----------------------------------------------------------------------
    // Members & roles
    // -----------------------------------------------------------------------

    async getRoles(projectId) {
        return this._get(`/projects/${projectId}/roles`);
    }

    async createRole(projectId, payload) {
        return this._post(`/projects/${projectId}/roles`, payload);
    }

    async updateRole(projectId, roleId, payload) {
        return this._patch(`/projects/${projectId}/roles/${roleId}`, payload);
    }

    async deleteRole(projectId, roleId) {
        return this._delete(`/projects/${projectId}/roles/${roleId}`);
    }

    async getMembers(projectId) {
        return this._get(`/projects/${projectId}/members`);
    }

    async getAssignableUsers(projectId) {
        return this._get(`/projects/${projectId}/assignable-users`);
    }

    async getMyAccess(projectId) {
        return this._get(`/projects/${projectId}/my-access`);
    }

    async inviteMember(projectId, username, roleIds) {
        return this._post(`/projects/${projectId}/members`, { username, role_ids: roleIds });
    }

    async setMemberRoles(projectId, username, roleIds) {
        return this._mutate("PUT", `/projects/${projectId}/members/${encodeURIComponent(username)}/roles`, { role_ids: roleIds });
    }

    async removeMember(projectId, username) {
        return this._delete(`/projects/${projectId}/members/${encodeURIComponent(username)}`);
    }

    // -----------------------------------------------------------------------
    // Backups
    // -----------------------------------------------------------------------

    async getBackupSources() {
        return this._get("/backups/sources");
    }

    async getBackupDiff(source, projectId) {
        return this._get(`/backups/${source}/projects/${projectId}/diff`);
    }

    async getBackupModulePreview(source, projectId, path) {
        return this._get(`/backups/${source}/projects/${projectId}/modules/${path.join("/")}`);
    }

    async pushBackup(source, projectId, paths, includeProjectMeta) {
        return this._post(`/backups/${source}/projects/${projectId}/push`, {
            paths,
            include_project_meta: includeProjectMeta,
        });
    }

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    async search(query, useRegex = false) {
        const params = new URLSearchParams({ q: query, regex: useRegex ? "true" : "false" });
        return this._get(`/search?${params.toString()}`);
    }

    // -----------------------------------------------------------------------
    // Inbox
    // -----------------------------------------------------------------------

    async getInbox() {
        return this._get("/inbox", { silent: true });
    }

    async getInboxUnreadCount() {
        return this._get("/inbox/unread-count", { silent: true });
    }

    async markInboxRead(messageId) {
        return this._post(`/inbox/${messageId}/read`, {});
    }

    async acceptInboxMessage(messageId) {
        return this._post(`/inbox/${messageId}/accept`, {});
    }

    async declineInboxMessage(messageId) {
        return this._post(`/inbox/${messageId}/decline`, {});
    }

    async deleteInboxMessage(messageId) {
        return this._delete(`/inbox/${messageId}`);
    }

    // -----------------------------------------------------------------------
    // Private HTTP helpers
    // -----------------------------------------------------------------------

    async _get(path, opts = {}) {
        const res = await fetch(BASE + path);
        return this._handleResponse(res, "GET", path, opts);
    }

    async _post(path, body) {
        return this._mutate("POST", path, body);
    }

    async _patch(path, body) {
        return this._mutate("PATCH", path, body);
    }

    async _delete(path) {
        const res = await fetch(BASE + path, { method: "DELETE" });
        return this._handleResponse(res, "DELETE", path);
    }

    async _mutate(method, path, body) {
        const res = await fetch(BASE + path, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return this._handleResponse(res, method, path);
    }

    /**
     * Central response handling for every request:
     *   401 -> session expired, send back to login
     *   403 -> show the permission-denied message as a toast (unless the
     *          caller passed { silent: true }, e.g. for the inbox badge
     *          poll, which shouldn't interrupt the user)
     *   other non-2xx -> throw with the server's message if it sent one
     */
    async _handleResponse(res, method, path, opts = {}) {
        if (res.status === 401) {
            window.location.href = "/auth";
            return new Promise(() => {}); // navigation is happening; don't resolve
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const message = err.error || `${method} ${path} \u2192 ${res.status}`;
            if (res.status === 403 && !opts.silent) Utils.showToast(message, "error");
            throw new Error(message);
        }

        if (res.status === 204) return null;
        return res.json();
    }
}

// Singleton — import once, use everywhere
const api = new ApiClient();
