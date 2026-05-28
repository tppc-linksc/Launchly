package com.launchly.worker.cleanup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 定期清理 /tmp/launchly-builds 下超过指定天数的构建目录，防止磁盘泄漏。
 */
@Service
public class BuildCleanupService {
    private static final Logger log = LoggerFactory.getLogger(BuildCleanupService.class);
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    @Value("${launchly.worker.cleanup.max-age-days:7}")
    private int maxAgeDays;

    /**
     * 每小时检查一次，清理超过 maxAgeDays 天的构建目录。
     */
    @Scheduled(fixedDelay = 3600000) // every hour
    public void cleanupOldBuilds() {
        Path root = Path.of(BUILD_ROOT);
        if (!Files.exists(root)) {
            return;
        }

        Instant cutoff = Instant.now().minus(maxAgeDays, ChronoUnit.DAYS);
        int deleted = 0;

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(root)) {
            for (Path buildDir : stream) {
                if (!Files.isDirectory(buildDir)) continue;

                try {
                    Instant lastModified = Files.getLastModifiedTime(buildDir).toInstant();
                    if (lastModified.isBefore(cutoff)) {
                        deleteRecursively(buildDir);
                        deleted++;
                        log.info("Cleaned up old build directory: {}", buildDir.getFileName());
                    }
                } catch (IOException e) {
                    log.warn("Failed to check/clean build directory {}: {}",
                            buildDir.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("Failed to list build root directory: {}", e.getMessage());
        }

        if (deleted > 0) {
            log.info("Build cleanup complete: removed {} directories older than {} days", deleted, maxAgeDays);
        }
    }

    private void deleteRecursively(Path dir) throws IOException {
        Files.walkFileTree(dir, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path d, IOException exc) throws IOException {
                Files.delete(d);
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
