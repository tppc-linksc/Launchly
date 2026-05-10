package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	switch os.Args[1] {
	case "install":
		fmt.Println("Launchly install scaffold: environment checks and compose bootstrap will be implemented in Week 2.")
	case "up", "down", "restart", "status", "logs", "upgrade", "backup", "restore", "doctor":
		fmt.Printf("Launchly %s scaffold: command handler is not implemented yet.\n", os.Args[1])
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println("Usage: launchly <install|up|down|restart|status|logs|upgrade|backup|restore|doctor>")
}

