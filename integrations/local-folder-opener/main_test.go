package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseRequest(t *testing.T) {
	got, err := parseRequest("elabftw-folder://open/84f0b17b-6d9a-4b52-9429-6fbdf663b424")
	if err != nil {
		t.Fatal(err)
	}
	if got.action != "open" || got.alias != "84f0b17b-6d9a-4b52-9429-6fbdf663b424" {
		t.Fatalf("unexpected request: %#v", got)
	}
}

func TestParseRequestRejectsPaths(t *testing.T) {
	bad := []string{
		"file:///Users/example/Documents",
		"elabftw-folder://delete/example",
		"elabftw-folder://open/../../etc",
		"elabftw-folder://open/name_with_underscore",
	}
	for _, raw := range bad {
		if _, err := parseRequest(raw); err == nil {
			t.Fatalf("expected %q to be rejected", raw)
		}
	}
}

func TestMappingRoundTrip(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "data")
	if err := os.Mkdir(folder, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := writeMapping(root, "example-id", folder); err != nil {
		t.Fatal(err)
	}
	got, err := readMapping(root, "example-id")
	if err != nil {
		t.Fatal(err)
	}
	if got != folder {
		t.Fatalf("got %q, want %q", got, folder)
	}
}
