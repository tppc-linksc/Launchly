package com.launchly.environment.controllers;

import com.launchly.environment.entities.Environment;
import com.launchly.environment.repositories.EnvironmentRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/environments")
public class EnvironmentController {
    private final EnvironmentRepository environmentRepository;

    public EnvironmentController(EnvironmentRepository environmentRepository) {
        this.environmentRepository = environmentRepository;
    }

    @GetMapping
    public ResponseEntity<List<Environment>> listByProject(@RequestParam String projectId) {
        return ResponseEntity.ok(environmentRepository.findByProjectIdOrderByTypeAsc(projectId));
    }
}
