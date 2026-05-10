package com.launchly.auth.controllers;

import com.launchly.auth.dto.SetupOwnerRequest;
import com.launchly.auth.dto.SetupOwnerResponse;
import com.launchly.auth.dto.SetupStatusResponse;
import com.launchly.auth.services.SetupService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/setup")
public class SetupController {
    private final SetupService setupService;

    public SetupController(SetupService setupService) {
        this.setupService = setupService;
    }

    @GetMapping("/status")
    public ResponseEntity<SetupStatusResponse> status() {
        return ResponseEntity.ok(setupService.getStatus());
    }

    @PostMapping("/owner")
    public ResponseEntity<SetupOwnerResponse> createOwner(@Valid @RequestBody SetupOwnerRequest request) {
        SetupOwnerResponse response = setupService.createOwner(request);
        return ResponseEntity.ok(response);
    }
}
