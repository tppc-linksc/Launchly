package com.launchly.common.controllers;

import com.launchly.common.config.EditionConfig;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/system")
public class SystemController {
    private final EditionConfig editionConfig;

    public SystemController(EditionConfig editionConfig) {
        this.editionConfig = editionConfig;
    }

    @GetMapping("/info")
    public ResponseEntity<Map<String, Object>> info() {
        return ResponseEntity.ok(Map.of(
                "edition", editionConfig.getEdition(),
                "isCloud", editionConfig.isCloud(),
                "version", "1.0.0-beta"
        ));
    }
}
