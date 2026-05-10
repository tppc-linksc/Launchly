package com.launchly.release.services;

import java.util.List;

public class GateCheckResult {
    private boolean allPassed;
    private List<GateResult> results;

    public GateCheckResult() {}

    public GateCheckResult(boolean allPassed, List<GateResult> results) {
        this.allPassed = allPassed;
        this.results = results;
    }

    public boolean isAllPassed() { return allPassed; }
    public void setAllPassed(boolean allPassed) { this.allPassed = allPassed; }
    public List<GateResult> getResults() { return results; }
    public void setResults(List<GateResult> results) { this.results = results; }

    public static class GateResult {
        private String gateName;
        private boolean passed;
        private String message;

        public GateResult() {}

        public GateResult(String gateName, boolean passed, String message) {
            this.gateName = gateName;
            this.passed = passed;
            this.message = message;
        }

        public String getGateName() { return gateName; }
        public void setGateName(String gateName) { this.gateName = gateName; }
        public boolean isPassed() { return passed; }
        public boolean passed() { return passed; }
        public void setPassed(boolean passed) { this.passed = passed; }
        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
    }
}
