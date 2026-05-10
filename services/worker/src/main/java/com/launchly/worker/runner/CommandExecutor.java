package com.launchly.worker.runner;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.util.concurrent.TimeUnit;

public class CommandExecutor {
    private static final Logger log = LoggerFactory.getLogger(CommandExecutor.class);

    private static final String[] SENSITIVE_PATTERNS = {
        "password", "token", "secret", "key", "PRIVATE KEY", "Authorization",
        "DATABASE_URL", "POSTGRES_PASSWORD", "DB_PASSWORD", "JWT_SECRET"
    };

    public static RunnerResult execute(String[] command, File workDir, int timeoutSeconds) {
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();

        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            if (workDir != null && workDir.exists()) {
                pb.directory(workDir);
            }
            pb.redirectErrorStream(false);

            Process process = pb.start();

            // Read stdout and stderr in parallel
            Thread stdoutThread = new Thread(() -> readStream(process.getInputStream(), stdout));
            Thread stderrThread = new Thread(() -> readStream(process.getErrorStream(), stderr));
            stdoutThread.start();
            stderrThread.start();

            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                stdoutThread.join(1000);
                stderrThread.join(1000);
                return RunnerResult.failure(
                    "Command timed out after " + timeoutSeconds + "s",
                    sanitize(stdout.toString()),
                    sanitize(stderr.toString()),
                    -1
                );
            }

            stdoutThread.join(5000);
            stderrThread.join(5000);

            int exitCode = process.exitValue();
            if (exitCode == 0) {
                return RunnerResult.success(sanitize(stdout.toString()), sanitize(stderr.toString()));
            } else {
                return RunnerResult.failure(
                    "Command exited with code " + exitCode,
                    sanitize(stdout.toString()),
                    sanitize(stderr.toString()),
                    exitCode
                );
            }
        } catch (IOException e) {
            return RunnerResult.failure("Command execution error: " + e.getMessage(),
                sanitize(stdout.toString()), sanitize(stderr.toString()), -1);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return RunnerResult.failure("Command interrupted",
                sanitize(stdout.toString()), sanitize(stderr.toString()), -1);
        }
    }

    public static RunnerResult execute(String command, File workDir, int timeoutSeconds) {
        return execute(new String[]{"/bin/sh", "-c", command}, workDir, timeoutSeconds);
    }

    private static void readStream(InputStream stream, StringBuilder sb) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
        } catch (IOException ignored) {
        }
    }

    public static String sanitize(String text) {
        if (text == null) return "";
        String result = text;
        for (String pattern : SENSITIVE_PATTERNS) {
            result = result.replaceAll(
                "(?i)(" + pattern + "\\s*[=:]\\s*)(\\S+)",
                "$1***REDACTED***"
            );
        }
        return result;
    }
}
