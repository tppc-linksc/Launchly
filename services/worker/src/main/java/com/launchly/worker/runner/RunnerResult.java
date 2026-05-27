package com.launchly.worker.runner;

public class RunnerResult {
    private boolean success;
    private String stdout;
    private String stderr;
    private int exitCode;
    private String errorMessage;

    public RunnerResult() {}

    public RunnerResult(boolean success, String stdout, String stderr, int exitCode, String errorMessage) {
        this.success = success;
        this.stdout = stdout;
        this.stderr = stderr;
        this.exitCode = exitCode;
        this.errorMessage = errorMessage;
    }

    public static RunnerResult success(String stdout, String stderr) {
        return new RunnerResult(true, stdout, stderr, 0, null);
    }

    public static RunnerResult failure(String errorMessage, String stdout, String stderr, int exitCode) {
        return new RunnerResult(false, stdout, stderr, exitCode, errorMessage);
    }

    public boolean isSuccess() { return success; }
    public void setSuccess(boolean success) { this.success = success; }
    public String getStdout() { return stdout; }
    public void setStdout(String stdout) { this.stdout = stdout; }
    public String getStderr() { return stderr; }
    public void setStderr(String stderr) { this.stderr = stderr; }
    public int getExitCode() { return exitCode; }
    public void setExitCode(int exitCode) { this.exitCode = exitCode; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
}
