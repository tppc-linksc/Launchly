package com.launchly.auth.services;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@Service
public class TokenService {
    private final SecretKey signingKey;
    private final long accessTokenExpiration;
    private final long refreshTokenExpiration;

    public TokenService(
            @Value("${launchly.jwt.secret}") String secret,
            @Value("${launchly.jwt.access-token-expiration}") long accessTokenExpiration,
            @Value("${launchly.jwt.refresh-token-expiration}") long refreshTokenExpiration) {
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenExpiration = accessTokenExpiration;
        this.refreshTokenExpiration = refreshTokenExpiration;
    }

    public String generateAccessToken(String userId, String workspaceId, String role) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("uid", userId);
        if (workspaceId != null) {
            claims.put("wid", workspaceId);
        }
        if (role != null) {
            claims.put("role", role);
        }
        return Jwts.builder()
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + accessTokenExpiration))
                .signWith(signingKey)
                .compact();
    }

    /** Backward-compatible overload without role. */
    public String generateAccessToken(String userId, String workspaceId) {
        return generateAccessToken(userId, workspaceId, null);
    }

    public String generateRefreshToken(String userId) {
        return Jwts.builder()
                .claims(Map.of("uid", userId))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + refreshTokenExpiration))
                .signWith(signingKey)
                .compact();
    }

    public Claims validateToken(String token) {
        return Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
