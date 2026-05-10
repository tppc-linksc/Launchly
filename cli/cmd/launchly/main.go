package main

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	dataDirEnv     = "LAUNCHLY_DATA_DIR"
	defaultDataDir = ".launchly"
	composeFile    = "docker-compose.yml"
	envFile        = ".env"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: unable to determine home directory: %v\n", err)
		os.Exit(1)
	}
	dataDir := os.Getenv(dataDirEnv)
	if dataDir == "" {
		dataDir = filepath.Join(home, defaultDataDir)
	}

	switch os.Args[1] {
	case "install":
		install(dataDir, os.Args[2:])
	case "up":
		up(dataDir)
	case "down":
		down(dataDir)
	case "restart":
		restart(dataDir)
	case "status":
		status(dataDir)
	case "logs":
		logs(dataDir, os.Args[2:])
	case "doctor":
		doctor()
	case "upgrade":
		upgrade(dataDir)
	case "backup":
		backup(dataDir)
	case "restore":
		restoreCmd(dataDir, os.Args[2:])
	case "uninstall":
		uninstall(dataDir, os.Args[2:])
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println(`Launchly CLI

Usage:
  launchly <command> [options]

Commands:
  install   Install Launchly services
  up        Start Launchly services
  down      Stop Launchly services
  restart   Restart Launchly services
  status    Show service status
  logs      View service logs
  doctor    Check system environment
  upgrade   Upgrade to latest version
  backup    Backup database and data
  restore   Restore from backup
  uninstall Remove Launchly installation

Options:
  install:
    --dry-run        Preview installation without making changes
    --port <port>    Set application port (default: 8080)

  logs:
    --service <name> Show logs for specific service (app, worker, postgres)
    --follow, -f     Follow log output

  restore:
    <backup-file>    Path to backup file to restore from

  uninstall:
    --force          Skip confirmation prompt
    --keep-data      Keep data directory and volumes`)
}

// --- install ---

func install(dataDir string, args []string) {
	dryRun := false
	port := "8080"
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dry-run":
			dryRun = true
		case "--port":
			if i+1 < len(args) {
				port = args[i+1]
				i++
			}
		}
	}

	if dryRun {
		installDryRun(dataDir, port)
		return
	}

	fmt.Println("=== Launchly Install ===")
	fmt.Println()

	composePath := filepath.Join(dataDir, composeFile)
	envPath := filepath.Join(dataDir, envFile)

	// 1. Create directories
	fmt.Println("Creating directories ...")
	dirs := []string{dataDir, filepath.Join(dataDir, "logs"), filepath.Join(dataDir, "data"), filepath.Join(dataDir, "config")}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", d, err)
			os.Exit(1)
		}
		fmt.Printf("  %s\n", d)
	}
	fmt.Println()

	// 2. Generate .env file if not exists
	if fileExists(envPath) {
		fmt.Printf("  .env file already exists at %s, skipping generation.\n", envPath)
	} else {
		fmt.Println("Generating .env file ...")
		dbPass := randomString(24)
		jwtSecret := randomString(32)
			envContent := fmt.Sprintf(`# Launchly Environment Configuration
LAUNCHLY_DB_PASSWORD=%s
LAUNCHLY_JWT_SECRET=%s
LAUNCHLY_ENCRYPTION_KEY=%s
LAUNCHLY_APP_PORT=%s
`, dbPass, jwtSecret, randomString(32), port)
		if err := os.WriteFile(envPath, []byte(envContent), 0600); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing .env file: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("  %s (permissions: 600)\n", envPath)
	}
	fmt.Println()

	// 3. Write docker-compose.yml
	fmt.Println("Writing docker-compose.yml ...")
	if err := os.WriteFile(composePath, []byte(composeTemplate()), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing compose file: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("  %s\n", composePath)
	fmt.Println()

	// 4. Start services
	fmt.Println("Starting services ...")
	if err := runCompose(dataDir, "up", "-d"); err != nil {
		fmt.Fprintf(os.Stderr, "Error starting services: %v\n", err)
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println("Installation complete.")
	fmt.Println()
	fmt.Println("Next steps:")
	fmt.Println("  1. Open http://localhost:" + port + "/setup in your browser")
	fmt.Println("  2. Create your owner account and workspace")
	fmt.Println()
}

func installDryRun(dataDir, port string) {
	fmt.Println("=== Launchly Install (Dry Run) ===")
	fmt.Println()
	fmt.Println("This is a dry run. No files or directories will be created.")
	fmt.Println()
	fmt.Println("Planned actions:")
	fmt.Println()
	fmt.Println("  1. Create data directory:")
	fmt.Printf("     %s\n", dataDir)
	fmt.Printf("     %s/logs\n", filepath.Join(dataDir, "logs"))
	fmt.Printf("     %s/data\n", filepath.Join(dataDir, "data"))
	fmt.Printf("     %s/config\n", filepath.Join(dataDir, "config"))
	fmt.Println()
	fmt.Println("  2. Generate .env file:")
	fmt.Printf("     %s/.env\n", dataDir)
	fmt.Println("     Contents: LAUNCHLY_DB_PASSWORD, LAUNCHLY_JWT_SECRET, LAUNCHLY_ENCRYPTION_KEY (auto-generated)")
	fmt.Println()
	fmt.Println("  3. Write docker-compose.yml")
	fmt.Println("     Services: launchly-postgres, launchly-app, launchly-worker")
	fmt.Println()
	fmt.Println("  4. Start Docker Compose services")
	fmt.Println()
	fmt.Println("  5. Run database migrations (Flyway)")
	fmt.Println()
	fmt.Println("  6. Output browser initialization URL:")
	fmt.Printf("     http://localhost:%s/setup\n", port)
	fmt.Println()
	fmt.Println("After installation completes, open the URL above in a browser")
	fmt.Println("to create the first Owner account and default Workspace.")
}

// --- up ---

func up(dataDir string) {
	fmt.Println("Starting Launchly services ...")
	if err := runCompose(dataDir, "up", "-d"); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Services started.")
}

// --- down ---

func down(dataDir string) {
	fmt.Println("Stopping Launchly services ...")
	if err := runCompose(dataDir, "down"); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Services stopped.")
}

// --- restart ---

func restart(dataDir string) {
	fmt.Println("Restarting Launchly services ...")
	if err := runCompose(dataDir, "restart"); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Services restarted.")
}

// --- status ---

func status(dataDir string) {
	cmd := exec.Command("docker", "compose", "-f", filepath.Join(dataDir, composeFile), "ps")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		// Try without compose file
		fmt.Println("Launchly services not found. Is Launchly installed? Run `launchly install` first.")
	}
}

// --- logs ---

func logs(dataDir string, args []string) {
	composeArgs := []string{"compose", "-f", filepath.Join(dataDir, composeFile), "logs"}
	follow := false
	for _, a := range args {
		if a == "--follow" || a == "-f" {
			follow = true
		} else if a == "--service" {
			// handled below by consuming the next arg
		} else {
			composeArgs = append(composeArgs, a)
		}
	}
	if follow {
		composeArgs = append(composeArgs, "-f")
	}

	cmd := exec.Command("docker", composeArgs...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// --- doctor ---

func doctor() {
	fmt.Println("=== Launchly Doctor ===")
	fmt.Println()

	checkDocker()
	checkDockerCompose()
	checkPorts()
	checkDiskSpace()
	checkDataDir()

	fmt.Println()
	fmt.Println("Doctor check complete.")
}

func checkDocker() {
	fmt.Print("Docker ....................... ")
	cmd := exec.Command("docker", "version", "--format", "{{.Server.Version}}")
	out, err := cmd.Output()
	if err != nil {
		fmt.Println("NOT FOUND")
		fmt.Println("  Fix: Install Docker from https://docs.docker.com/get-docker/")
		return
	}
	fmt.Printf("OK (v%s)\n", strings.TrimSpace(string(out)))
}

func checkDockerCompose() {
	fmt.Print("Docker Compose .............. ")
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("SKIP (Docker not found)")
		return
	}
	cmd := exec.Command("docker", "compose", "version", "--short")
	out, err := cmd.Output()
	if err != nil {
		cmd2 := exec.Command("docker-compose", "version", "--short")
		out2, err2 := cmd2.Output()
		if err2 != nil {
			fmt.Println("NOT FOUND")
			fmt.Println("  Fix: Docker Compose is included with recent Docker Desktop,")
			fmt.Println("        or install the docker-compose plugin.")
			return
		}
		fmt.Printf("OK (v%s)\n", strings.TrimSpace(string(out2)))
		return
	}
	fmt.Printf("OK (v%s)\n", strings.TrimSpace(string(out)))
}

func checkPorts() {
	fmt.Println("Ports ........................")
	ports := []struct {
		port int
		name string
	}{
		{8080, "launchly-app"},
		{5173, "launchly-web (dev)"},
		{5432, "launchly-postgres"},
	}
	for _, p := range ports {
		fmt.Printf("  %d (%s) ............... ", p.port, p.name)
		cmd := exec.Command("lsof", "-i", fmt.Sprintf(":%d", p.port), "-sTCP:LISTEN")
		out, _ := cmd.Output()
		if len(out) > 0 {
			fmt.Println("IN USE")
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")
			if len(lines) > 1 {
				fmt.Printf("    Currently used by: %s\n", extractProcess(lines[1]))
			}
		} else {
			fmt.Println("FREE")
		}
	}
}

func checkDiskSpace() {
	fmt.Print("Disk space ................... ")
	home, _ := os.UserHomeDir()
	var stat syscallStat
	if err := syscallDiskStat(home, &stat); err != nil {
		fmt.Println("UNABLE TO CHECK")
		return
	}
	availGB := float64(stat.Bavail*uint64(stat.Bsize)) / 1_073_741_824
	if availGB < 1.0 {
		fmt.Printf("WARNING (%.1f GB available in %s)\n", availGB, home)
		fmt.Println("  Launchly needs at least 1 GB free space.")
	} else {
		fmt.Printf("OK (%.1f GB available in %s)\n", availGB, home)
	}
}

func checkDataDir() {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, ".launchly")
	fmt.Printf("Data directory (%s) ... ", dataDir)
	if info, err := os.Stat(dataDir); err == nil {
		if info.IsDir() {
			fmt.Println("EXISTS")
		} else {
			fmt.Println("EXISTS BUT NOT A DIRECTORY")
		}
	} else {
		fmt.Println("NOT YET CREATED (will be created on install)")
	}
}

func extractProcess(line string) string {
	fields := strings.Fields(line)
	if len(fields) >= 2 {
		return fields[1]
	}
	return "unknown"
}

// --- backup ---

func backup(dataDir string) {
	timestamp := timeNow().Format("20060102-150405")
	backupFile := filepath.Join(dataDir, "backups", fmt.Sprintf("launchly-backup-%s.tar.gz", timestamp))

	fmt.Printf("Creating backup: %s\n", backupFile)
	os.MkdirAll(filepath.Join(dataDir, "backups"), 0755)

	// Dump the database
	dbFile := filepath.Join(dataDir, "backups", "db_dump.sql")
	cmd := exec.Command("docker", "compose", "-f", filepath.Join(dataDir, composeFile),
		"exec", "-T", "launchly-postgres", "pg_dumpall", "-U", "launchly")
	out, err := cmd.Output()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error dumping database: %v\n", err)
		fmt.Fprintln(os.Stderr, "Make sure Launchly is running (`launchly up`) and try again.")
		os.Exit(1)
	}
	if err := os.WriteFile(dbFile, out, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing database dump: %v\n", err)
		os.Exit(1)
	}

	// Create tar.gz with db dump + env file
	tmpDir := filepath.Join(dataDir, "backups", "tmp_"+timestamp)
	os.MkdirAll(tmpDir, 0755)
	os.Rename(dbFile, filepath.Join(tmpDir, "db_dump.sql"))
	envSrc := filepath.Join(dataDir, envFile)
	if fileExists(envSrc) {
		copyFile(envSrc, filepath.Join(tmpDir, envFile))
	}

	tarCmd := exec.Command("tar", "-czf", backupFile, "-C", tmpDir, ".")
	tarCmd.Stdout = os.Stdout
	tarCmd.Stderr = os.Stderr
	if err := tarCmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating archive: %v\n", err)
		os.Exit(1)
	}

	os.RemoveAll(tmpDir)
	fmt.Printf("Backup created: %s\n", backupFile)
}

func restoreCmd(dataDir string, args []string) {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: launchly restore <backup-file>")
		fmt.Fprintln(os.Stderr, "  backup-file  Path to a backup archive created by `launchly backup`")
		os.Exit(1)
	}
	backupFile := args[0]
	if !fileExists(backupFile) {
		fmt.Fprintf(os.Stderr, "Error: backup file not found: %s\n", backupFile)
		os.Exit(1)
	}

	fmt.Printf("Restoring from: %s\n", backupFile)
	fmt.Println("Warning: This will overwrite existing data. Make sure services are stopped.")
	fmt.Print("Continue? [y/N] ")
	var answer string
	fmt.Scanln(&answer)
	if strings.ToLower(answer) != "y" {
		fmt.Println("Aborted.")
		return
	}

	// Extract
	restoreDir := filepath.Join(dataDir, "restore_tmp")
	os.RemoveAll(restoreDir)
	os.MkdirAll(restoreDir, 0755)
	defer os.RemoveAll(restoreDir)

	cmd := exec.Command("tar", "-xzf", backupFile, "-C", restoreDir)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error extracting backup: %v\n", err)
		os.Exit(1)
	}

	// Restore database
	dumpFile := filepath.Join(restoreDir, "db_dump.sql")
	if fileExists(dumpFile) {
		fmt.Println("Restoring database ...")
		restoreCmd := exec.Command("docker", "compose", "-f", filepath.Join(dataDir, composeFile),
			"exec", "-T", "launchly-postgres", "psql", "-U", "launchly", "-d", "launchly")
		data, err := os.ReadFile(dumpFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading dump file: %v\n", err)
			os.Exit(1)
		}
		restoreCmd.Stdin = strings.NewReader(string(data))
		restoreCmd.Stdout = os.Stdout
		restoreCmd.Stderr = os.Stderr
		if err := restoreCmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Error restoring database: %v\n", err)
			os.Exit(1)
		}
	}

	fmt.Println("Restore complete.")
}

// --- upgrade ---

func upgrade(dataDir string) {
	fmt.Println("Upgrading Launchly ...")
	fmt.Println("Pulling latest images ...")
	if err := runCompose(dataDir, "pull"); err != nil {
		fmt.Fprintf(os.Stderr, "Error pulling images: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Recreating services ...")
	if err := runCompose(dataDir, "up", "-d"); err != nil {
		fmt.Fprintf(os.Stderr, "Error restarting services: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Upgrade complete.")
}

// --- uninstall ---

func uninstall(dataDir string, args []string) {
	force := false
	keepData := false
	for _, a := range args {
		if a == "--force" {
			force = true
		}
		if a == "--keep-data" {
			keepData = true
		}
	}

	if !force {
		fmt.Println("WARNING: This will stop and remove all Launchly services.")
		if !keepData {
			fmt.Println("         All data will be deleted (use --keep-data to preserve).")
		}
		fmt.Print("Type 'yes' to confirm: ")
		var answer string
		fmt.Scanln(&answer)
		if answer != "yes" {
			fmt.Println("Aborted.")
			return
		}
	}

	fmt.Println("Stopping services ...")
	runCompose(dataDir, "down", "-v")

	if !keepData {
		fmt.Println("Removing data directory ...")
		os.RemoveAll(dataDir)
		fmt.Printf("  %s removed\n", dataDir)
	}

	fmt.Println("Launchly has been uninstalled.")
}

// --- helpers ---

func runCompose(dataDir string, args ...string) error {
	base := []string{"compose", "-f", filepath.Join(dataDir, composeFile)}
	// Use --env-file if .env exists
	envPath := filepath.Join(dataDir, envFile)
	if fileExists(envPath) {
		base = append(base, "--env-file", envPath)
	}
	base = append(base, args...)
	cmd := exec.Command("docker", base...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}

func composeTemplate() string {
	return `version: "3.8"

services:
  launchly-postgres:
    image: postgres:16-alpine
    container_name: launchly-postgres
    environment:
      POSTGRES_USER: launchly
      POSTGRES_PASSWORD: ${LAUNCHLY_DB_PASSWORD}
      POSTGRES_DB: launchly
    volumes:
      - launchly-postgres-data:/var/lib/postgresql/data
    networks:
      - launchly-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U launchly"]
      interval: 5s
      timeout: 3s
      retries: 5

  launchly-app:
    image: ${LAUNCHLY_APP_IMAGE:-ghcr.io/launchly/launchly-app:latest}
    container_name: launchly-app
    ports:
      - "${LAUNCHLY_APP_PORT:-8080}:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://launchly-postgres:5432/launchly
      SPRING_DATASOURCE_USERNAME: launchly
      SPRING_DATASOURCE_PASSWORD: ${LAUNCHLY_DB_PASSWORD}
      LAUNCHLY_JWT_SECRET: ${LAUNCHLY_JWT_SECRET}
      LAUNCHLY_ENCRYPTION_KEY: ${LAUNCHLY_ENCRYPTION_KEY}
      LAUNCHLY_DATA_DIR: /data
    volumes:
      - launchly-data:/data
      - ${LAUNCHLY_DATA_DIR:-~/.launchly}/logs:/data/logs
    networks:
      - launchly-net
    depends_on:
      launchly-postgres:
        condition: service_healthy
    restart: unless-stopped

  launchly-worker:
    image: ${LAUNCHLY_WORKER_IMAGE:-ghcr.io/launchly/launchly-worker:latest}
    container_name: launchly-worker
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://launchly-postgres:5432/launchly
      SPRING_DATASOURCE_USERNAME: launchly
      SPRING_DATASOURCE_PASSWORD: ${LAUNCHLY_DB_PASSWORD}
      LAUNCHLY_JWT_SECRET: ${LAUNCHLY_JWT_SECRET}
      LAUNCHLY_ENCRYPTION_KEY: ${LAUNCHLY_ENCRYPTION_KEY}
      LAUNCHLY_DATA_DIR: /data
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - launchly-data:/data
      - ${LAUNCHLY_DATA_DIR:-~/.launchly}/logs:/data/logs
    networks:
      - launchly-net
    depends_on:
      launchly-postgres:
        condition: service_healthy
    restart: unless-stopped

networks:
  launchly-net:
    driver: bridge

volumes:
  launchly-postgres-data:
  launchly-data:
`
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			panic(err)
		}
		b[i] = letters[idx.Int64()]
	}
	return string(b)
}
