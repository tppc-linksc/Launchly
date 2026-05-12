package com.launchly.auth;

import com.launchly.auth.services.TokenService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class TokenServiceTest {

    @Autowired
    private TokenService tokenService;

    @Test
    void shouldGenerateAndValidateAccessToken() {
        String token = tokenService.generateAccessToken("user-1", "workspace-1");

        assertNotNull(token);
        Claims claims = tokenService.validateToken(token);

        assertEquals("user-1", claims.get("uid", String.class));
        assertEquals("workspace-1", claims.get("wid", String.class));
    }

    @Test
    void shouldGenerateAndValidateRefreshToken() {
        String token = tokenService.generateRefreshToken("user-1");

        assertNotNull(token);
        Claims claims = tokenService.validateToken(token);

        assertEquals("user-1", claims.get("uid", String.class));
    }

    @Test
    void shouldGenerateAccessTokenWithoutWorkspace() {
        String token = tokenService.generateAccessToken("user-2", null);

        assertNotNull(token);
        Claims claims = tokenService.validateToken(token);

        assertEquals("user-2", claims.get("uid", String.class));
        assertNull(claims.get("wid"));
    }

    @Test
    void shouldRejectInvalidToken() {
        assertThrows(Exception.class, () -> {
            tokenService.validateToken("invalid-token-string");
        });
    }

    @Test
    void shouldRejectTamperedToken() {
        String token = tokenService.generateAccessToken("user-1", "ws-1");
        String tampered = token.substring(0, token.length() - 5) + "XXXXX";

        assertThrows(Exception.class, () -> {
            tokenService.validateToken(tampered);
        });
    }

    @Test
    void shouldGenerateUniqueTokens() throws Exception {
        String token1 = tokenService.generateAccessToken("user-1", "ws-1");
        // JWT iat has second precision; ensure different timestamps
        Thread.sleep(1100);
        String token2 = tokenService.generateAccessToken("user-1", "ws-1");

        assertNotEquals(token1, token2);
        // Both should be valid
        tokenService.validateToken(token1);
        tokenService.validateToken(token2);
    }

    @Test
    void shouldContainStandardClaims() {
        String token = tokenService.generateAccessToken("user-1", "ws-1");
        Claims claims = tokenService.validateToken(token);

        assertNotNull(claims.getIssuedAt());
        assertNotNull(claims.getExpiration());
        assertTrue(claims.getExpiration().after(claims.getIssuedAt()));
    }
}
