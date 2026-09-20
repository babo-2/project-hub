/**
 * profile.js — the "👤 username" button in the topbar. Opens a small
 * dropdown with Settings (account-settings.js, currently an empty
 * placeholder) and Logout (reuses the existing #logout-btn wiring from
 * Utils.bindLogout, since that button lives inside this dropdown now).
 */

class ProfileMenu {
    constructor() {
        this.btn      = document.getElementById("profile-btn");
        this.dropdown = document.getElementById("profile-dropdown");
        if (!this.btn) return; // not logged in - nothing to wire up

        this.btn.addEventListener("click", e => {
            e.stopPropagation();
            this._toggle();
        });

        document.addEventListener("click", e => {
            if (!this.dropdown.contains(e.target) && e.target !== this.btn) this._close();
        });

        document.getElementById("profile-settings-btn")?.addEventListener("click", () => {
            this._close();
            accountSettingsPanel.open();
        });
    }

    _toggle() {
        const isOpen = this.dropdown.style.display === "block";
        this.dropdown.style.display = isOpen ? "none" : "block";
    }

    _close() {
        this.dropdown.style.display = "none";
    }
}

document.addEventListener("DOMContentLoaded", () => new ProfileMenu());
