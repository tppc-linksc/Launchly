package com.launchly.environment.services;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

@Service
public class SecretValueService {
    private static final String PREFIX = "v1:";
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private final SecretKeySpec keySpec;
    private final SecureRandom secureRandom = new SecureRandom();

    public SecretValueService(@Value("${launchly.encryption.key}") String key) {
        this.keySpec = new SecretKeySpec(sha256(key), "AES");
    }

    public String encrypt(String value) {
        if (value == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            secureRandom.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            ByteBuffer payload = ByteBuffer.allocate(iv.length + encrypted.length);
            payload.put(iv);
            payload.put(encrypted);
            return PREFIX + Base64.getEncoder().encodeToString(payload.array());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to encrypt secret value", e);
        }
    }

    private byte[] sha256(String key) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to initialize encryption key", e);
        }
    }
}
