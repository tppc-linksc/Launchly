package com.launchly.worker.runner;

import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.EnvironmentRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.springframework.stereotype.Component;

import java.io.File;

@Component
public class GitRunner implements Runner {

    private static final int CLONE_TIMEOUT = 300; // 5 minutes
    private static final int PULL_TIMEOUT = 120;
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;

    public GitRunner(ProjectRepository projectRepository, EnvironmentRepository environmentRepository) {
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
    }

    @Override
    public RunnerResult execute(RunnerContext context) {
        String refId = context.getRefId();
        String projectId = (String) context.getPayload().getOrDefault("projectId", "");
        String environmentId = (String) context.getPayload().getOrDefault("environmentId", "");
        String branch = (String) context.getPayload().getOrDefault("branch", "main");
        String commitSha = (String) context.getPayload().getOrDefault("commitSha", "");

        Project project = projectRepository.findById(projectId).orElse(null);
        String repoUrl = project != null ? project.getRepositoryUrl() : null;
        if (repoUrl == null || repoUrl.isEmpty()) {
            return RunnerResult.failure("No repository URL configured for project", "", "", -1);
        }

        File workRoot = resolveWorkRoot(environmentId);
        File workDir = new File(workRoot, projectId + "/" + refId);
        workDir.mkdirs();

        // Check if already cloned
        File gitDir = new File(workDir, ".git");
        if (gitDir.exists()) {
            RunnerResult result = pull(workDir, branch);
            return result.isSuccess() ? checkoutCommitIfPresent(workDir, commitSha, result) : result;
        } else {
            RunnerResult result = clone(repoUrl, branch, workDir);
            return result.isSuccess() ? checkoutCommitIfPresent(workDir, commitSha, result) : result;
        }
    }

    private RunnerResult checkoutCommitIfPresent(File workDir, String commitSha, RunnerResult previous) {
        if (commitSha == null || commitSha.isBlank()) {
            return previous;
        }
        RunnerResult checkoutResult = CommandExecutor.execute(
                new String[]{"git", "checkout", commitSha}, workDir, PULL_TIMEOUT);
        if (!checkoutResult.isSuccess()) {
            return RunnerResult.failure("Git checkout commit failed: " + checkoutResult.getErrorMessage(),
                    previous.getStdout() + checkoutResult.getStdout(),
                    previous.getStderr() + checkoutResult.getStderr(),
                    checkoutResult.getExitCode());
        }
        return RunnerResult.success(previous.getStdout() + "Checked out commit " + commitSha + "\n" + checkoutResult.getStdout(),
                previous.getStderr() + checkoutResult.getStderr());
    }

    private RunnerResult clone(String repoUrl, String branch, File targetDir) {
        // Remove directory if it exists but has no .git
        if (targetDir.exists() && !new File(targetDir, ".git").exists()) {
            deleteRecursive(targetDir);
            targetDir.mkdirs();
        }

        String sanitizedUrl = sanitizeUrl(repoUrl);
        String[] cmd = {"git", "clone", "--depth", "1", "--branch", branch, repoUrl, targetDir.getAbsolutePath()};

        RunnerResult result = CommandExecutor.execute(cmd, targetDir.getParentFile(), CLONE_TIMEOUT);
        if (!result.isSuccess()) {
            return RunnerResult.failure(
                "Git clone failed for " + sanitizedUrl + " branch=" + branch + ": " + result.getErrorMessage(),
                result.getStdout(), result.getStderr(), result.getExitCode()
            );
        }
        return RunnerResult.success("Cloned " + sanitizedUrl + " (branch: " + branch + ")\n" + result.getStdout(),
            result.getStderr());
    }

    private RunnerResult pull(File workDir, String branch) {
        // Fetch and checkout
        RunnerResult fetchResult = CommandExecutor.execute(
            new String[]{"git", "fetch", "origin", branch}, workDir, PULL_TIMEOUT);
        if (!fetchResult.isSuccess()) {
            return RunnerResult.failure("Git fetch failed: " + fetchResult.getErrorMessage(),
                fetchResult.getStdout(), fetchResult.getStderr(), fetchResult.getExitCode());
        }

        RunnerResult checkoutResult = CommandExecutor.execute(
            new String[]{"git", "checkout", branch}, workDir, PULL_TIMEOUT);
        if (!checkoutResult.isSuccess()) {
            return RunnerResult.failure("Git checkout failed: " + checkoutResult.getErrorMessage(),
                checkoutResult.getStdout(), checkoutResult.getStderr(), checkoutResult.getExitCode());
        }

        RunnerResult pullResult = CommandExecutor.execute(
            new String[]{"git", "pull", "origin", branch}, workDir, PULL_TIMEOUT);

        return RunnerResult.success(
            "Pulled branch " + branch + "\n" + fetchResult.getStdout() + pullResult.getStdout(),
            fetchResult.getStderr() + pullResult.getStderr());
    }

    private File resolveWorkRoot(String environmentId) {
        if (environmentId != null && !environmentId.isBlank()) {
            return environmentRepository.findById(environmentId)
                    .map(DockerRunner::resolveBuildRoot)
                    .orElseGet(() -> new File(BUILD_ROOT));
        }
        return new File(BUILD_ROOT);
    }

    private String sanitizeUrl(String url) {
        if (url == null) return "";
        return url.replaceAll("https?://[^@]+@", "https://***@");
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }
}
