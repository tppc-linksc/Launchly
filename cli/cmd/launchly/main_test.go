package main

import (
	"os"
	"testing"
)

func TestKnownCommandsDoNotPanic(t *testing.T) {
	// Only test commands that don't require Docker or filesystem state
	safeCommands := []string{"doctor"}
	for _, cmd := range safeCommands {
		os.Args = []string{"launchly", cmd}
		// doctor will run and report environment status - it shouldn't panic
		main()
	}
}

func TestUnknownCommand(t *testing.T) {
	os.Args = []string{"launchly", "unknown"}
	main()
}

func TestNoCommand(t *testing.T) {
	os.Args = []string{"launchly"}
	main()
}

func TestPrintUsage(t *testing.T) {
	printUsage()
}

func TestFileExists(t *testing.T) {
	if fileExists("/nonexistent/path/12345") {
		t.Error("expected false for nonexistent path")
	}
	if !fileExists("/") {
		t.Error("expected true for /")
	}
}

func TestComposeTemplate(t *testing.T) {
	tmpl := composeTemplate()
	if len(tmpl) == 0 {
		t.Error("compose template should not be empty")
	}
	if !contains(tmpl, "launchly-postgres") {
		t.Error("template should contain launchly-postgres service")
	}
	if !contains(tmpl, "launchly-app") {
		t.Error("template should contain launchly-app service")
	}
	if !contains(tmpl, "launchly-worker") {
		t.Error("template should contain launchly-worker service")
	}
}

func TestRandomString(t *testing.T) {
	s := randomString(32)
	if len(s) != 32 {
		t.Errorf("expected length 32, got %d", len(s))
	}
	// Should be different each time
	s2 := randomString(32)
	if s == s2 {
		t.Error("random strings should be different")
	}
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && len(s) >= len(substr) &&
		searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
