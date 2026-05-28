package com.launchly;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@EnableAsync
public class LaunchlyApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(LaunchlyApiApplication.class, args);
    }

    @RestController
    static class HealthController {
        @GetMapping("/api/health")
        public HealthResponse health() {
            return new HealthResponse("ok", "launchly-api");
        }
    }

    record HealthResponse(String status, String service) {
    }
}
