package com.launchly.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.Bean;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EntityScan(basePackages = "com.launchly.worker.entities")
@EnableJpaRepositories(basePackages = "com.launchly.worker.repositories")
@EnableScheduling
public class LaunchlyWorkerApplication {
    public static void main(String[] args) {
        SpringApplication.run(LaunchlyWorkerApplication.class, args);
    }

    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper();
    }
}
