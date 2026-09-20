/**
 * inbox.js — personal inbox: system messages (currently just project
 * invites) and, eventually, user-to-user messages (schema/UI is ready for
 * that "kind", nothing produces one yet).
 *
 * Self-contained like members.js/backups.js: builds its own modal DOM and
 * also owns the little unread-count badge on whichever "Inbox" button is
 * on the current page.
 */

class InboxPanel {
    constructor() {
        this._buildDom();
        this._badgeEls = [];
    }

    /** Call once per page with the Inbox button element to keep its badge in sync. */
    registerBadge(buttonEl) {
        if (!buttonEl) return;
        this._badgeEls.push(buttonEl);
        this.refreshBadge();
    }

    async refreshBadge() {
        try {
            const { count } = await api.getInboxUnreadCount();
            this._badgeEls.forEach(btn => {
                let badge = btn.querySelector(".badge-count");
                if (!badge) {
                    badge = document.createElement("span");
                    badge.className = "badge-count";
                    btn.appendChild(badge);
                }
                badge.textContent = count;
                badge.hidden = count === 0;
            });
        } catch {
            // badge is a nice-to-have; a failed poll shouldn't be noisy
        }
    }

    async open() {
        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
        this._filter = "all";
        await this._refresh();
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
        this.refreshBadge();
    }

    async _refresh() {
        this.body.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            this.messages = await api.getInbox();
            this._render();
        } catch (err) {
            this.body.innerHTML = `<p class="error">${Utils.escape(err.message)}</p>`;
        }
    }

    _render() {
        const filtered = this.messages.filter(m => this._filter === "all" || m.kind === this._filter);

        this.body.innerHTML = `
            <div class="backup-tabs">
                <button class="backup-tab ${this._filter === "all" ? "active" : ""}" data-filter="all">All</button>
                <button class="backup-tab ${this._filter === "system" ? "active" : ""}" data-filter="system">System</button>
                <button class="backup-tab ${this._filter === "user" ? "active" : ""}" data-filter="user">User</button>
            </div>
            <div class="inbox-list">
                ${filtered.map(m => this._messageRow(m)).join("") || `<p class="loading">Nothing here.</p>`}
            </div>
        `;

        this.body.querySelectorAll(".backup-tab").forEach(tab => {
            tab.addEventListener("click", () => { this._filter = tab.dataset.filter; this._render(); });
        });

        this.body.querySelectorAll(".btn-inbox-accept").forEach(btn => {
            btn.addEventListener("click", () => this._resolve(Number(btn.dataset.id), "accept"));
        });
        this.body.querySelectorAll(".btn-inbox-decline").forEach(btn => {
            btn.addEventListener("click", () => this._resolve(Number(btn.dataset.id), "decline"));
        });
        this.body.querySelectorAll(".btn-inbox-dismiss").forEach(btn => {
            btn.addEventListener("click", () => this._dismiss(Number(btn.dataset.id)));
        });
    }

    _messageRow(m) {
        const isPendingInvite = m.type === "invite" && m.status === "unread";
        const statusLabel = { unread: "New", read: "Read", accepted: "Accepted", declined: "Declined" }[m.status] ?? m.status;

        return `
            <div class="inbox-row ${m.status === "unread" ? "unread" : ""}">
                <div class="inbox-row-main">
                    <span class="inbox-row-title">${Utils.escape(m.title)}</span>
                    <span class="perm-chip ${m.kind === "system" ? "" : "perm-chip-muted"}">${m.kind}</span>
                    ${!isPendingInvite ? `<span class="inbox-row-status">${statusLabel}</span>` : ""}
                </div>
                ${m.body ? `<p class="inbox-row-body">${Utils.escape(m.body)}</p>` : ""}
                <span class="inbox-row-time text-muted">${Utils.formatDateTime(m.created_at)}</span>
                <div class="inbox-row-actions">
                    ${isPendingInvite ? `
                        <button class="btn btn-primary btn-sm btn-inbox-accept" data-id="${m.id}">Accept</button>
                        <button class="btn btn-ghost   btn-sm btn-inbox-decline" data-id="${m.id}">Decline</button>
                    ` : `
                        <button class="btn-icon btn-inbox-dismiss" data-id="${m.id}" title="Dismiss">✕</button>
                    `}
                </div>
            </div>
        `;
    }

    async _resolve(id, action) {
        try {
            if (action === "accept") await api.acceptInboxMessage(id);
            else await api.declineInboxMessage(id);
            await this._refresh();
            this.refreshBadge();
            if (action === "accept") Utils.showToast("Invite accepted", "info");
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    async _dismiss(id) {
        try {
            await api.deleteInboxMessage(id);
            await this._refresh();
            this.refreshBadge();
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    _buildDom() {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal modal-wide" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>Inbox</h2>
                    <button class="btn-icon" id="inbox-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body inbox-modal-body"></div>
            </div>
        `;
        document.body.appendChild(this.backdrop);
        this.body = this.backdrop.querySelector(".inbox-modal-body");

        this.backdrop.querySelector("#inbox-modal-close").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this.close(); });
    }
}

const inboxPanel = new InboxPanel();
