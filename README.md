# Project Hub

A local, self-hosted project organisation tool. Modular by design Multi-user with
per-project ownership and role-based permissions, (should) work offline, and keeps
a rolling history of snapshots you can browse and restore from.


---

## Project structure

```
project-hub/
├── app.py                   # Flask entry point
├── config.py                # All tuneable settings
├── db/
│   ├── database.py          # SQLite schema + migrations
│   ├── auth.py               # Loads/saves accounts + sessions
│   └── backup.py             # Pluggable backup backends
├── models/
│   ├── project.py            # Project CRUD
│   ├── module.py              # Module CRUD (type-agnostic)
│   ├── auth.py                 # Account/session storage, thread-safe
│   ├── permissions.py          # Roles, members, permission checks
│   ├── backup_browser.py       # Diffing/restoring from old snapshots
│   ├── backup.py       	# saving the backup
│   ├── inbox.py       		# Inbox
│   └── search.py               # Project/module search
├── routes/
│   ├── frontend.py           # Serves the HTML/CSS/JS
│   ├── auth.py                 # /auth (login, register, logout, session gate)
│   ├── projects.py             # /api/projects
│   ├── modules.py              # /api/projects/:id/modules
│   ├── members.py              # /api/projects/:id/roles, /members
│   ├── backups.py              # /api/backups
│   ├── search.py               # /api/search
│   ├── inbox.py                # /api/inbox
│   └── access.py               # @require_permission decorator
└── frontend/
    ├── index.html            # Project selection page
    ├── project.html          # Single project view
    ├── auth.html             # Login / register page
    ├── css/
    └── js/
        ├── utils.js           # Shared escape/date/logout helpers
        ├── api.js              # All fetch calls
        ├── module-modal.js     # "Add Module" modal
        ├── settings.js         # project settings
        ├── account-settings.js # account settings (placeholder for now)
        ├── profile.js          # Profile dropdown (for now just Settings/logout)
        ├── inbox.js            # Inbox
        ├── app.js              # Main page logic (+ search, import)
        ├── project.js          # Project page logic (rename, drag reorder)
        ├── members.js          # "Manage access" panel
        ├── backups.js          # "History" panel (diff + restore)
        ├── sw.js               # Service worker (offline + sync) (WIP)
        └── modules/
            ├── registry.js     # Plugin registry
            ├── notes.js
            ├── board.js        # sticky board
            ├── calender.js
            ├── checklist.js
            ├── drawio.js       
            ├── embed.js        # WIP
            ├── template.js
            ├── folder.js
            ├── links.js
            └── roadmap.js
```

---

## Permissions

Each project has one **owner** (whoever created it — always full access)
and any number of **members**. Access for members is granted through
**roles**, which you define per project: a role is just a name plus a set
of permissions. (still WIP)

| Permission | Grants |
|---|---|
| `view` | See the project and its modules |
| `edit_project` | Change name / description / color |
| `delete_project` | Delete the project |
| `manage_modules` | Create, edit, delete, reorder, and rename modules |
| `manage_members` | Invite/remove members, create/edit/delete roles |
| `manage_backups` | Browse history and restore from a snapshot |

Manage roles and members from the **Manage access** button on a project
page (only visible if you have `manage_members`). Create a role, check the
permissions it should carry, then invite a registered user and assign them
that role — a member can hold any number of roles at once.

---

## History & backups

The app snapshots the database automatically ~10 minutes after a change
(configurable via `BACKUP_DEBOUNCE_SECONDS` in `config.py`). Once more than
`BACKUP_MAX_SNAPSHOTS` (default 10) individual snapshots pile up, the
oldest get rolled into a daily `.zip` archive so history doesn't grow
forever.

Open **History** on a project page (needs `manage_backups`) to:
- Browse recent snapshots, or drill into a daily archive to see the
  snapshots rolled up inside it.
- See a diff of every module against that point in time — new, changed,
  unchanged, or created since.
- Preview a module's content as it was in that snapshot.
- Push individual modules, or everything, back into the live project.
  Project name/description/color can optionally be restored too.

---

## Offline mode

The service worker mirrors your projects and modules into IndexedDB.
While offline you can keep creating, editing, and reordering — changes are
queued and replayed against the server automatically once the connection
comes back (via the Background Sync API where supported, and on the
browser's `online` event everywhere else). The status dot in the topbar
reflects current connectivity.

---

## How to add a new module type

This is the main extension point.

**Create `frontend/js/modules/your_type.js`:**

```js
class YourModule {
    type        = "your_type";           // unique, snake_case
    label       = "Your Module";         // shown in the UI
    icon        = "🧩";
    defaultData = { /* your initial shape */ };

    render(container, moduleData, { onSave }) {
        // Mount your UI into `container`.
        // Call onSave(newData) to persist.
        container.innerHTML = `<p>Hello from ${moduleData.title}</p>`;
    }
}

registry.register(new YourModule());
```

Use `Utils.escape()` (from `utils.js`) for anything user-provided that you
interpolate into HTML — including inside attributes like `src="..."`.

**Then add one `<script>` tag in `project.html`, after `registry.js`:**

```html
<script src="/js/modules/your_type.js"></script>
```

That's it — the registry, API, DB, offline sync, and backup diffing all
handle the new type automatically since modules are stored as an opaque
JSON blob keyed by `module_type`.

---

## How to add a backup backend

Open `db/backup.py`, subclass `BackupBackend`, implement `run()`, and swap
the `active_backend` line:

```python
class S3Backup(BackupBackend):
    def run(self) -> str:
        # upload Config.DB_PATH to S3
        return "s3://my-bucket/hub.db"

active_backend = S3Backup()
```

`BACKUP_ENABLED = True` in `config.py` is the default. The History panel's
snapshot/daily browsing only understands the local-file layout, so a
custom remote backend won't show up there — it's for redundancy, not
browsing.

---

## API reference

### Projects
| Method | Path | Permission |
|---|---|---|
| GET | `/api/projects/` | — (filtered to what you can see) |
| POST | `/api/projects/` | — (you become the owner) |
| GET | `/api/projects/:id` | `view` |
| PATCH | `/api/projects/:id` | `edit_project` |
| DELETE | `/api/projects/:id` | `delete_project` |
| GET | `/api/projects/:id/export` | `view` |
| POST | `/api/projects/import` | — (you become the owner) |

### Modules
| Method | Path | Permission |
|---|---|---|
| GET | `/api/projects/:id/modules` | `view` |
| POST | `/api/projects/:id/modules` | `manage_modules` |
| POST | `/api/projects/:id/modules/reorder` | `manage_modules` |
| POST | `/api/projects/:id/modules/import` | `manage_modules` |
| GET | `/api/projects/modules/:id` | `view` |
| PATCH | `/api/projects/modules/:id` | `manage_modules` |
| DELETE | `/api/projects/modules/:id` | `manage_modules` |
| GET | `/api/projects/modules/:id/export` | `view` |

### Roles & members
| Method | Path | Permission |
|---|---|---|
| GET / POST | `/api/projects/:id/roles` | `manage_members` |
| PATCH / DELETE | `/api/projects/:id/roles/:role_id` | `manage_members` |
| GET / POST | `/api/projects/:id/members` | `manage_members` |
| PUT | `/api/projects/:id/members/:username/roles` | `manage_members` |
| DELETE | `/api/projects/:id/members/:username` | `manage_members` |

### Backups
| Method | Path | Permission |
|---|---|---|
| GET | `/api/backups/sources` | — |
| GET | `/api/backups/:source/projects/:id/diff` | `manage_backups` |
| GET | `/api/backups/:source/projects/:id/modules/:module_id` | `manage_backups` |
| POST | `/api/backups/:source/projects/:id/push` | `manage_backups` |

`:source` is `snapshot/<filename>` or `daily/<day>/<filename>`.

### Search
| Method | Path |
|---|---|
| GET | `/api/search?q=...&regex=true\|false` |

### Auth
| Method | Path |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/register` (needs `CAN_REGISTER = True`) |
| POST | `/auth/logout` |

### Inbox
| Method | Path |
|---|---|
| GET | `/api/inbox` |
| GET | `/api/inbox/unread-count`|
| POST | `/api/inbox/:id/read` |
| POST | `/api/inbox/:id/accept` |
| POST | `/api/inbox/:id/decline` |
| DELETE | `/api/inbox/:id` |

---

## Config reference (`config.py`)

| Setting | Default | Notes |
|---|---|---|
| `SECRET_KEY` | random per-run | Set via env var; see Quick start |
| `SESSION_LIFETIME_SECONDS` | 7 days | Sessions auto-expire after this |
| `CAN_REGISTER` | `False` | Gate for `/auth/register` |
| `BACKUP_ENABLED` | `True` | Master switch for snapshotting |
| `BACKUP_DEBOUNCE_SECONDS` | 600 (10 min) | Delay after a change before snapshotting |
| `BACKUP_MAX_SNAPSHOTS` | 10 | Snapshots beyond this roll into a daily zip |
