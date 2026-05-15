package com.launchly.project.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.project.dto.RepositoryHintsResponse;
import com.launchly.project.entities.Project;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Best-effort inference from public Git hosting raw files (no clone, no tokens).
 * Fills sensible defaults so users only need name + repo URL (+ deploy target when used).
 */
@Service
public class RepositoryHintsService {

    private static final Pattern GITHUB_HTTPS = Pattern.compile(
            "https?://github\\.com/([^/]+)/([^/]+?)(?:\\.git)?/?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern GITHUB_SSH = Pattern.compile(
            "git@github\\.com:([^/]+)/([^/]+?)(?:\\.git)?", Pattern.CASE_INSENSITIVE);

    private static final Pattern GITLAB_HTTPS = Pattern.compile(
            "https?://gitlab\\.com/(.+?)(?:\\.git)?/?$", Pattern.CASE_INSENSITIVE);

    private static final Pattern GITEE_HTTPS = Pattern.compile(
            "https?://gitee\\.com/(.+?)(?:\\.git)?/?$", Pattern.CASE_INSENSITIVE);

    private static final Pattern PORT_IN_SCRIPT = Pattern.compile(
            "(?:--port|-p)\\s+(\\d{2,5})\\b|\\bPORT\\s*=\\s*(\\d{2,5})\\b");

    private static final Pattern README_INSTALL_LINE = Pattern.compile(
            "(?i)^\\s*((?:npm|pnpm|yarn)\\s+\\S+(?:\\s+\\S+)*)\\s*$");

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Merge inferred values into {@code project} for any command/port/health field that is still blank.
     */
    public void fillBlanksFromRepository(Project project) {
        if (!hasText(project.getRepositoryUrl())) {
            return;
        }
        String branch = hasText(project.getDefaultBranch()) ? project.getDefaultBranch() : "main";
        RepositoryHintsResponse hints = infer(project.getRepositoryUrl().trim(), branch)
                .orElse(RepositoryHintsResponse.defaults());
        if (!hasText(project.getInstallCommand()) && hasText(hints.installCommand())) {
            project.setInstallCommand(hints.installCommand());
        }
        if (!hasText(project.getBuildCommand()) && hasText(hints.buildCommand())) {
            project.setBuildCommand(hints.buildCommand());
        }
        if (!hasText(project.getStartCommand()) && hasText(hints.startCommand())) {
            project.setStartCommand(hints.startCommand());
        }
        if (!hasText(project.getTestCommand()) && hasText(hints.testCommand())) {
            project.setTestCommand(hints.testCommand());
        }
        if (project.getDefaultPort() == null && hints.defaultPort() != null) {
            project.setDefaultPort(hints.defaultPort());
        }
        if (!hasText(project.getHealthCheckPath()) && hasText(hints.healthCheckPath())) {
            project.setHealthCheckPath(hints.healthCheckPath());
        }
    }

    public Optional<RepositoryHintsResponse> infer(String repositoryUrl, String branch) {
        if (!hasText(repositoryUrl) || !hasText(branch)) {
            return Optional.empty();
        }
        String refEnc = branch.replace("/", "%2F");
        Optional<String> pkgUrl = rawPackageJsonUrl(repositoryUrl.trim(), refEnc);
        if (pkgUrl.isEmpty()) {
            return Optional.empty();
        }
        Optional<String> jsonBody = httpGetString(pkgUrl.get());
        if (jsonBody.isEmpty()) {
            return Optional.empty();
        }
        try {
            JsonNode root = mapper.readTree(jsonBody.get());
            PackageManager pm = detectPackageManager(root, repositoryUrl.trim(), refEnc);

            JsonNode scripts = root.path("scripts");
            String startScript = textOrNull(scripts, "start");
            String buildScript = textOrNull(scripts, "build");
            String testScript = textOrNull(scripts, "test");

            String install = installCommand(pm);
            String build = buildScript != null ? runScript(pm, "build") : null;
            String start = startCommand(pm);
            String test = testScript != null ? runScript(pm, "test") : null;

            Integer port = parsePortFromStart(startScript);
            if (port == null) {
                port = 3000;
            }

            String source = "package.json";
            Optional<String> readmeLine = readmeInstallLine(repositoryUrl.trim(), refEnc);
            if (readmeLine.isPresent()
                    && pm == PackageManager.NPM
                    && (readmeLine.get().contains("pnpm") || readmeLine.get().contains("yarn"))) {
                install = readmeLine.get();
                source = "package.json+readme";
            }

            return Optional.of(new RepositoryHintsResponse(
                    install,
                    build,
                    start,
                    test,
                    port,
                    null,
                    source
            ));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private Optional<String> readmeInstallLine(String repositoryUrl, String refEnc) {
        Optional<String> readmeUrl = rawReadmeUrl(repositoryUrl, refEnc);
        if (readmeUrl.isEmpty()) {
            return Optional.empty();
        }
        Optional<String> body = httpGetString(readmeUrl.get());
        if (body.isEmpty()) {
            return Optional.empty();
        }
        for (String line : body.get().split("\n")) {
            Matcher m = README_INSTALL_LINE.matcher(line);
            if (m.matches()) {
                return Optional.of(m.group(1).trim());
            }
        }
        return Optional.empty();
    }

    private Optional<String> rawReadmeUrl(String repositoryUrl, String refEnc) {
        Matcher gh = GITHUB_HTTPS.matcher(repositoryUrl);
        if (gh.matches()) {
            return Optional.of(String.format(
                    "https://raw.githubusercontent.com/%s/%s/%s/README.md",
                    gh.group(1), gh.group(2), refEnc));
        }
        Matcher ghs = GITHUB_SSH.matcher(repositoryUrl);
        if (ghs.matches()) {
            return Optional.of(String.format(
                    "https://raw.githubusercontent.com/%s/%s/%s/README.md",
                    ghs.group(1), ghs.group(2), refEnc));
        }
        Matcher gl = GITLAB_HTTPS.matcher(repositoryUrl);
        if (gl.matches()) {
            return Optional.of(String.format(
                    "https://gitlab.com/%s/-/raw/%s/README.md",
                    gl.group(1), refEnc));
        }
        Matcher ge = GITEE_HTTPS.matcher(repositoryUrl);
        if (ge.matches()) {
            return Optional.of(String.format(
                    "https://gitee.com/%s/raw/%s/README.md",
                    ge.group(1), refEnc));
        }
        return Optional.empty();
    }

    private Optional<String> rawPackageJsonUrl(String repositoryUrl, String refEnc) {
        Matcher gh = GITHUB_HTTPS.matcher(repositoryUrl);
        if (gh.matches()) {
            return Optional.of(String.format(
                    "https://raw.githubusercontent.com/%s/%s/%s/package.json",
                    gh.group(1), gh.group(2), refEnc));
        }
        Matcher ghs = GITHUB_SSH.matcher(repositoryUrl);
        if (ghs.matches()) {
            return Optional.of(String.format(
                    "https://raw.githubusercontent.com/%s/%s/%s/package.json",
                    ghs.group(1), ghs.group(2), refEnc));
        }
        Matcher gl = GITLAB_HTTPS.matcher(repositoryUrl);
        if (gl.matches()) {
            return Optional.of(String.format(
                    "https://gitlab.com/%s/-/raw/%s/package.json",
                    gl.group(1), refEnc));
        }
        Matcher ge = GITEE_HTTPS.matcher(repositoryUrl);
        if (ge.matches()) {
            return Optional.of(String.format(
                    "https://gitee.com/%s/raw/%s/package.json",
                    ge.group(1), refEnc));
        }
        return Optional.empty();
    }

    private enum PackageManager {
        NPM, PNPM, YARN
    }

    private PackageManager detectPackageManager(JsonNode root, String repositoryUrl, String refEnc) {
        String pmField = textOrNull(root, "packageManager");
        if (pmField != null) {
            if (pmField.startsWith("pnpm")) {
                return PackageManager.PNPM;
            }
            if (pmField.startsWith("yarn")) {
                return PackageManager.YARN;
            }
        }
        Optional<String> base = rawPackageJsonUrl(repositoryUrl, refEnc);
        if (base.isPresent()) {
            String u = base.get();
            int slash = u.lastIndexOf('/');
            String prefix = u.substring(0, slash + 1);
            if (resourceExists(prefix + "pnpm-lock.yaml")) {
                return PackageManager.PNPM;
            }
            if (resourceExists(prefix + "yarn.lock")) {
                return PackageManager.YARN;
            }
        }
        return PackageManager.NPM;
    }

    private boolean resourceExists(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .method("HEAD", HttpRequest.BodyPublishers.noBody())
                    .timeout(Duration.ofSeconds(8))
                    .header("User-Agent", "Launchly-RepositoryHints/1.0")
                    .build();
            HttpResponse<Void> res = http.send(req, HttpResponse.BodyHandlers.discarding());
            if (res.statusCode() == 200) {
                return true;
            }
            if (res.statusCode() == 405 || res.statusCode() == 404) {
                return httpGetString(url).map(s -> !s.isBlank()).orElse(false);
            }
        } catch (Exception ignored) {
            return httpGetString(url).map(s -> !s.isBlank()).orElse(false);
        }
        return false;
    }

    private String installCommand(PackageManager pm) {
        return switch (pm) {
            case PNPM -> "corepack enable && pnpm install --frozen-lockfile";
            case YARN -> "corepack enable && yarn install --immutable";
            case NPM -> "npm ci --omit=dev || npm install --omit=dev";
        };
    }

    private String runScript(PackageManager pm, String script) {
        return switch (pm) {
            case PNPM -> "pnpm run " + script;
            case YARN -> "yarn " + script;
            case NPM -> "npm run " + script;
        };
    }

    private String startCommand(PackageManager pm) {
        return switch (pm) {
            case PNPM -> "pnpm start";
            case YARN -> "yarn start";
            case NPM -> "npm start";
        };
    }

    private Integer parsePortFromStart(String startScript) {
        if (startScript == null) {
            return null;
        }
        Matcher m = PORT_IN_SCRIPT.matcher(startScript);
        if (m.find()) {
            String g = m.group(1) != null ? m.group(1) : m.group(2);
            try {
                return Integer.parseInt(g);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private String textOrNull(JsonNode parent, String field) {
        JsonNode n = parent.get(field);
        if (n == null || n.isNull() || !n.isTextual()) {
            return null;
        }
        String t = n.asText().trim();
        return t.isEmpty() ? null : t;
    }

    private Optional<String> httpGetString(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("User-Agent", "Launchly-RepositoryHints/1.0")
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() >= 200 && res.statusCode() < 300) {
                String body = res.body();
                if (body != null && body.length() > 2_000_000) {
                    return Optional.empty();
                }
                return Optional.ofNullable(body);
            }
        } catch (Exception ignored) {
            return Optional.empty();
        }
        return Optional.empty();
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }
}
