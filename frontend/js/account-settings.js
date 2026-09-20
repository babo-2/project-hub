/**
 * account-settings.js — account-level settings overlay (distinct from a
 * project's Settings panel). Empty placeholder for now.
 */

class AccountSettingsPanel {
    constructor() {
        this._buildDom();
    }

    open() {
        this.backdrop.hidden = false;
        this.backdrop.style.display = "flex";
    }

    close() {
        this.backdrop.style.display = "none";
        this.backdrop.hidden = true;
    }

    _buildDom() {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "modal-backdrop";
        this.backdrop.hidden = true;
        this.backdrop.style.display = "none";
        this.backdrop.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>Settings</h2>
                    <button class="btn-icon" id="account-settings-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <p class="text-muted">Nothing here yet.</p>
                </div>
            </div>
        `;
        document.body.appendChild(this.backdrop);
        this.backdrop.querySelector("#account-settings-close").addEventListener("click", () => this.close());
        this.backdrop.addEventListener("click", e => { if (e.target === this.backdrop) this.close(); });
    }
}

const accountSettingsPanel = new AccountSettingsPanel();
