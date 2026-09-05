# Komga API

BookOrbit exposes a Komga-compatible API so comic reader apps built for [Komga](https://komga.org)
can browse your libraries and read comics page by page without downloading whole archives. Mihon
and the Tachiyomi forks, Suwayomi, Komelia and Paperback all connect through their Komga source.

The API is read-only: it serves what BookOrbit already knows about your books. Nothing a client
does through it changes your library.

## Enable the API

Settings > Devices > Komga. An administrator with `manage_app_settings` turns on **Komga API**. It
is off on a fresh install and independent of the OPDS toggle, so you can run one without the other.

While it is off every Komga route answers `403 Komga API is disabled`.

## Server address and accounts

Clients need two things: the server address shown on the settings page, `https://your-host/komga`,
and a Komga account. Komga accounts are separate credentials tied to your BookOrbit user, in the same
way OPDS accounts are. Create as many as you like, one per device is a good habit, and delete one
when a device is lost. A deleted account stops working immediately.

Users need the `komga_access` permission to create accounts. It sits in the Devices group next to
OPDS and is part of the standard permission preset. If an administrator removes the permission or
deactivates the user, every account of that user is refused.

Passwords are stored hashed and cannot be shown again. Lose one, delete the account, create a new
one.

Each account has two options:

| Option                           | Default | Effect                                                                                                                                                            |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Group books without a series** | on      | Comics that belong to no series appear together as one `Unknown Series` per library. Off, each such comic is its own one-shot series.                             |
| **Include non-comic books**      | off     | EPUB, MOBI, AZW3, FB2 and PDF books also appear. Komga clients cannot render them; they can download them through the file endpoint. PDFs are marked unsupported. |

Audiobooks never appear.

## What a client sees

Komga organises a library into series that contain books. BookOrbit maps its own data onto that
model without changing anything:

- **Libraries** are your libraries, limited to the ones the user can access. Content filters set on
  the user apply to everything, so a filtered book is invisible in lists, series counts, pages and
  downloads alike.
- **Series** are BookOrbit series, one per library they occur in. A book in two series is listed
  under both, with the number it has in each. Books without a series go to the `Unknown Series`
  bucket or become one-shots, depending on the account option above.
- **Book numbers** come from the series index. Books without an index sort after the numbered ones,
  by title, and are numbered after the highest index in the series. Set series indexes in the
  metadata editor to get the chapter order you expect in Mihon.
- **Pages** are read straight from CBZ, CBR and CB7 archives one page at a time. Clients that ask for
  `convert=png` or `convert=jpeg` get the page transcoded on the fly.
- **Thumbnails** are the BookOrbit cover thumbnails; a series shows the cover of its lowest numbered
  book.
- **Series metadata** such as publisher, language, genres, tags and authors is aggregated from the
  member books. Comic credits (pencillers, inkers, colorists, letterers, cover artists) are reported
  with their Komga roles.

Series ids look like `12-s34`, `12-u` or `12-b567` (library, then series, unknown bucket or
one-shot book). Book ids are BookOrbit book ids. Clients treat both as opaque strings.

## Setting up a client

**Mihon, TachiyomiSY, J2K, Suwayomi**: install the Komga extension, open its settings, add a
server with the address from the settings page and the account username and password. The
extension lists your libraries as filters and each series as an entry.

**Komelia**: sign in with the server address and account. Komelia hides its management screens
because the account carries no admin role; browsing, reading and downloads work.

**Paperback**: add the Komga source and enter the same address and credentials.

If a client asks for a URL ending in `/api/v1`, use the address exactly as shown; the `/api/v1`
part is added by the client.

## Not available yet

- **Read progress** from Komga clients is not synced yet. Marking a chapter read in Mihon does not
  reach BookOrbit, and progress made in the web reader is not shown to Komga clients. Every book
  reports as unread. This is the next Komga release.
- **Search and list endpoints** used by newer clients (`POST /series/list`, `POST /books/list`) are
  not implemented. Mihon and its forks use the older list endpoints, which are.
- **Read lists and collections** answer with empty lists. Collections and smart scopes are planned
  to appear as Komga read lists.
- **Reading direction** is always left to right until the metadata field exists.
- **PDF page streaming**: PDFs are listed as unsupported and can only be downloaded.
- Server management endpoints (scans, metadata edits, users, settings) are deliberately not
  provided. Unknown paths answer a JSON 404.

## Troubleshooting

- **401 on every request**: wrong username or password, or the account was deleted. Create a new
  account and update the client.
- **403 Komga API is disabled**: an administrator has to enable the API in Settings > Devices > Komga.
- **403 Komga access revoked**: the user lost `komga_access` or was deactivated.
- **A series is missing**: the user has no access to that library, a content filter hides its books,
  or the comics are in a format BookOrbit does not treat as comics (CBZ, CBR, CB7).
- **A book shows 0 pages**: the archive has not been counted yet. Opening it once, or the next
  library scan, fills the count in.
- **Chapters are in the wrong order**: set series indexes on the books. Books without an index are
  appended after the numbered ones.
- **Behind a reverse proxy**: forward `/komga` to BookOrbit exactly like `/api`. The path must not
  fall through to the web app.
