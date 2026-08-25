// eLabFTW Folder Opener resolves opaque eLabFTW folder IDs to local paths.
package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const scheme = "elabftw-folder"

var aliasPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,80}$`)

type request struct {
	action string
	alias  string
}

func parseRequest(raw string) (request, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != scheme {
		return request{}, errors.New("invalid eLabFTW folder URL")
	}
	action := parsed.Host
	if action != "open" && action != "register" {
		return request{}, errors.New("unsupported folder action")
	}
	alias := strings.Trim(parsed.EscapedPath(), "/")
	alias, err = url.PathUnescape(alias)
	if err != nil || !aliasPattern.MatchString(alias) {
		return request{}, errors.New("invalid folder identifier")
	}
	return request{action: action, alias: alias}, nil
}

func configDirectory() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "elabftw-folder-opener", "mappings"), nil
}

func mappingPath(root, alias string) string {
	return filepath.Join(root, alias+".path")
}

func readMapping(root, alias string) (string, error) {
	content, err := os.ReadFile(mappingPath(root, alias))
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(string(content))
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return "", errors.New("the mapped folder is unavailable")
	}
	return path, nil
}

func writeMapping(root, alias, path string) error {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return errors.New("the selected path is not a folder")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	return os.WriteFile(mappingPath(root, alias), []byte(path+"\n"), 0o600)
}

func chooseFolder() (string, error) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("osascript", "-e", `POSIX path of (choose folder with prompt "Choose the folder for this eLabFTW shortcut")`)
	case "windows":
		command = exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Choose the folder for this eLabFTW shortcut'; if ($dialog.ShowDialog() -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) } else { exit 1 }`)
	default:
		if path, err := exec.LookPath("zenity"); err == nil {
			command = exec.Command(path, "--file-selection", "--directory", "--title=Choose the folder for this eLabFTW shortcut")
		} else if path, err := exec.LookPath("kdialog"); err == nil {
			command = exec.Command(path, "--getexistingdirectory", ".", "--title", "Choose the folder for this eLabFTW shortcut")
		} else {
			return "", errors.New("install zenity or kdialog to choose a folder")
		}
	}
	output, err := command.Output()
	if err != nil {
		return "", errors.New("folder selection was cancelled")
	}
	path := strings.TrimSpace(string(output))
	if path == "" {
		return "", errors.New("no folder was selected")
	}
	return filepath.Clean(path), nil
}

func openFolder(path string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", path)
	case "windows":
		command = exec.Command("explorer.exe", path)
	default:
		command = exec.Command("xdg-open", path)
	}
	return command.Start()
}

func showError(message string) {
	switch runtime.GOOS {
	case "darwin":
		_ = exec.Command("osascript", "-e", fmt.Sprintf(`display alert "eLabFTW Folder Opener" message %q`, message)).Run()
	case "windows":
		escaped := strings.ReplaceAll(message, "'", "''")
		_ = exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", fmt.Sprintf(`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%s', 'eLabFTW Folder Opener')`, escaped)).Run()
	default:
		if path, err := exec.LookPath("zenity"); err == nil {
			_ = exec.Command(path, "--error", "--title=eLabFTW Folder Opener", "--text="+message).Run()
		}
	}
}

func run(rawURL string) error {
	req, err := parseRequest(rawURL)
	if err != nil {
		return err
	}
	root, err := configDirectory()
	if err != nil {
		return err
	}

	path, readErr := readMapping(root, req.alias)
	if req.action == "register" || readErr != nil {
		path, err = chooseFolder()
		if err != nil {
			return err
		}
		if err := writeMapping(root, req.alias, path); err != nil {
			return err
		}
	}
	return openFolder(path)
}

func main() {
	if len(os.Args) != 2 {
		showError("This helper must be opened from an eLabFTW local folder shortcut.")
		os.Exit(2)
	}
	if err := run(os.Args[1]); err != nil {
		showError(err.Error())
		os.Exit(1)
	}
}
