package com.launchly.auth;

import com.launchly.auth.services.PasswordService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class PasswordServiceTest {

    @Autowired
    private PasswordService passwordService;

    @Test
    void shouldHashPassword() {
        String hash = passwordService.hash("my-secure-password");

        assertNotNull(hash);
        assertTrue(hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$"));
    }

    @Test
    void shouldRejectNullPassword() {
        assertThrows(IllegalArgumentException.class, () -> {
            passwordService.hash(null);
        });
    }

    @Test
    void shouldRejectEmptyPassword() {
        assertThrows(IllegalArgumentException.class, () -> {
            passwordService.hash("");
        });
    }

    @Test
    void shouldRejectBlankPassword() {
        assertThrows(IllegalArgumentException.class, () -> {
            passwordService.hash("   ");
        });
    }

    @Test
    void shouldMatchCorrectPassword() {
        String hash = passwordService.hash("my-password");
        assertTrue(passwordService.matches("my-password", hash));
    }

    @Test
    void shouldNotMatchWrongPassword() {
        String hash = passwordService.hash("my-password");
        assertFalse(passwordService.matches("wrong-password", hash));
    }

    @Test
    void shouldHandleNullPasswordInMatches() {
        String hash = passwordService.hash("test");
        assertFalse(passwordService.matches(null, hash));
    }

    @Test
    void shouldHandleNullHashInMatches() {
        assertFalse(passwordService.matches("password", null));
    }

    @Test
    void shouldGenerateDifferentHashEachTime() {
        String hash1 = passwordService.hash("same-password");
        String hash2 = passwordService.hash("same-password");

        assertNotEquals(hash1, hash2);
        // Both should match the original password
        assertTrue(passwordService.matches("same-password", hash1));
        assertTrue(passwordService.matches("same-password", hash2));
    }
}
