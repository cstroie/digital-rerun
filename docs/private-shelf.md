# A private shelf

**Private shelf** is DigitalRerun's feature for managing software you own but may not share (such as the Infocom collections, WordStar, compilers, etc.). This software never goes into the DigitalRerun repository or the app itself. Instead, it lives in a catalog on your own web server. The *Private* section of SHELF (in DRIVES) points the app at this catalog, and a disk image is fetched only when you insert it into a drive. Nothing is cached by the service worker, ensuring your private software stays on your servers.

## Purpose and Benefits

- **Privacy**: Software you own but may not share (WordStar, Turbo Pascal, commercial games) never leaves your devices
- **Scalability**: Keep large collections on a web server instead of embedding them in the app
- **Access control**: Use tokens to restrict who can access your private catalog
- **Flexibility**: Add or remove software from your catalog without updating the app

## How it Works

1. **Catalog Creation**: Build a catalog from your software using `tools/private-shelf.js`
2. **Hosting**: Serve the catalog from your own web server (static file server or specialized tool)
3. **Connection**: Point DigitalRerun to your catalog via SHELF (in DRIVES) → Private
4. **Usage**: Insert disks from your catalog into drives as needed

## Key Differences from Public Shelf

| Feature | Public Shelf | Private Shelf |
|---------|-------------|---------------|
| **Source** | Built into the app repository | On your own web server |
| **Storage** | Cached in the app for offline use | Never cached (fetched on demand) |
| **Access** | Anyone with the app can use it | Only those who know your catalog URL |
| **Software** | Free to share software only | Your own software, any license |

Nothing is cached by the service worker, so your private software stays on your servers and doesn't become part of the DigitalRerun app.

## 1. Build the catalog

```
node tools/private-shelf.js <folder with the story files> <out> [--category=Infocom]
```

Every Z-machine story (`.z1`–`.z8`, or the `.dat` files of the DOS releases,
recognised by their header) under the source folder becomes a game disk, a folder in `<out>`:
the story, `VEZZA.COM`, `PLAY.COM`, `VEZZA.LIC` and a `README.TXT`, on the smallest
disk that holds it (8" 250K, 5¼" 400K, or a hard disk). `<out>/shelf.json` lists them.
Names come from the file names; an optional `<folder>/titles.json` names them:

```json
{ "zork1.dat": { "name": "Zork I", "description": "…", "category": "Infocom" } }
```

Software that is no story (WordStar, a compiler …) goes in `<folder>/disks/`, or in a folder of any name one level down
(`<folder>/OFFICE/WS40/`, as long as it holds no story and `titles.json` names it): each
folder there becomes one disk of its files, as the app's FROM FOLDER makes it. The files
in it go to user 0, subfolders named `1` to `15` to those user areas, names CP/M cannot
hold are made 8.3 (the tool says which), text files get CP/M line ends, and the smallest
of the 8", 400K 5¼" and hard disk formats that holds it is used. `titles.json` names such
a disk by its folder's name, lower case: `"wordstar": { "name": "WordStar 4" }`.

Vezza reads Z-machine versions 1 to 8, so Z4 and Z5 stories are taken as well as Z3,
but only as far as a text console goes: the graphical version (6) will not run on
this machine. A large story (Trinity, A Mind Forever Voyaging) may need the 400K disk,
which the tool then chooses by itself. Only Z3 was tried here; if a Z4 or Z5 story
misbehaves, that is worth knowing.

No disk image is made. Each disk is a folder `<out>/<id>/` holding its files, and
`shelf.json` lists them (`files`: name, path, and `user` for a user area), as the shipped
`disks/shelf.json` does for the public shelf; the app builds the disk when you insert it.
An entry with `system` (a file holding the bytes of the system tracks) makes a bootable disk; the public shelf's CP/M 3 disk is one (`docs/cpm3.md`).
A disk image you made yourself can still be added by hand, with `image` and `format` in place of `files`.

## 2. Serve it

Any static web server will do, as long as the app can reach it.

- **The app and the catalog on the same server** (say the catalog under `/games/`):
  nothing else is needed. Enter `/games/` as the address.
- **The app elsewhere** (GitHub Pages), the catalog on your own box: the catalog must
  be **https** with a certificate the browser trusts (a page served over https may not
  read plain http, except from `localhost`), and must allow the app's origin.

For a static server (lighttpd), allow the origin and keep the folder's name hard to guess:
without a token the browser sends a plain request and no preflight is needed.

```
server.modules += ( "mod_setenv" )
$HTTP["url"] =~ "^/games-7f3k9q/" {
    setenv.add-response-header = (
        "Access-Control-Allow-Origin" => "https://cstroie.github.io",
        "Access-Control-Allow-Private-Network" => "true",
        "Cache-Control" => "no-store"
    )
}
```

The app also sends a token (`Authorization: Bearer …`) when you enter one. That makes
the browser send a preflight (OPTIONS) first, which the server must answer `204` with
`Access-Control-Allow-Headers: Authorization`, without the token. A plain static
server cannot do that; `tools/private-serve.js` can, and is also the quick way to try
a catalog:

```
node tools/private-serve.js <out> --port=8099 --token=secret [--origin=https://cstroie.github.io]
```

It speaks http: fine for `http://localhost`, not for anything else.

## 3. Connect the app

SHELF (in DRIVES) → *Private*: the catalog's address (a folder, or the `.json`) and the
token if there is one → CONNECT. The address and token are kept in this browser
(`localStorage`) and the catalog is read again whenever the app opens; FORGET removes
both. A catalog that cannot be reached says so under the heading (address, https
certificate, CORS); the public shelf is unaffected.
