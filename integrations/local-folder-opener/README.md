# eLabFTW Folder Opener

This optional workstation helper opens eLabFTW **local folder shortcuts** in Finder, Windows Explorer, or the Linux file manager. It never uploads a folder and never sends its local path to the eLabFTW server.

Each shortcut stores only a random identifier and a label in the experiment or resource metadata. On each computer, the helper maps that identifier to a folder selected by the user. This means two collaborators can map the same shortcut to different local or network-mounted folders.

## Install on macOS

Install Go 1.22 or newer, then run:

```sh
./install-macos.sh
```

The installer creates `~/Applications/eLabFTW Folder Opener.app` and registers the `elabftw-folder://` URL scheme. The first browser launch might ask for permission to open the app.

## Install on Windows

Install Go 1.22 or newer, open PowerShell in this directory, and run:

```powershell
.\install-windows.ps1
```

The installer places the helper under `%LOCALAPPDATA%` and registers the URL scheme for the current Windows account.

## Use

1. Add a shortcut in an experiment or resource under **Links → Files / folders**, or choose **Link → Local folder shortcut…** in the editor.
2. Click the folder name. If this computer has no mapping yet, choose the folder in the native picker.
3. Later clicks open that folder directly. Use the folder-plus button to change the mapping on the current computer.

Mappings are stored with user-only permissions in the operating system's user configuration directory. The helper accepts only opaque identifiers and the actions `open` and `register`; URLs cannot contain filesystem paths or shell commands.
