//go:build linux

package main

import "syscall"

type syscallStat struct {
	Bavail uint64
	Bsize  uint64
}

func syscallDiskStat(path string, stat *syscallStat) error {
	var fsStat syscall.Statfs_t
	if err := syscall.Statfs(path, &fsStat); err != nil {
		return err
	}
	stat.Bavail = fsStat.Bavail
	stat.Bsize = uint64(fsStat.Bsize)
	return nil
}
