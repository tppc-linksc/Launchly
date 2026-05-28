package com.launchly.common.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SecurityConfigValidator {
    private static final Logger log = LoggerFactory.getLogger(SecurityConfigValidator.class);
    private static final String DEFAULT_SECRET = "launchly-dev-secret-do-not-use-in-production";

    @Value("${launchly.jwt.secret}")
    private String jwtSecret;

    @Value("${launchly.encryption.key}")
    private String encryptionKey;

    @PostConstruct
    public void validate() {
        boolean hasDefaultSecrets = false;

        if (DEFAULT_SECRET.equals(jwtSecret)) {
            log.error("========================================");
            log.error("!! 安全警告: JWT Secret 为默认值 !!");
            log.error("!! 请通过环境变量 LAUNCHLY_JWT_SECRET 设置强密钥");
            log.error("========================================");
            hasDefaultSecrets = true;
        }

        if (DEFAULT_SECRET.equals(encryptionKey)) {
            log.error("========================================");
            log.error("!! 安全警告: Encryption Key 为默认值 !!");
            log.error("!! 请通过环境变量 LAUNCHLY_ENCRYPTION_KEY 设置强密钥");
            log.error("========================================");
            hasDefaultSecrets = true;
        }

        if (hasDefaultSecrets) {
            throw new IllegalStateException(
                    "检测到默认安全密钥，请设置 LAUNCHLY_JWT_SECRET 和 LAUNCHLY_ENCRYPTION_KEY 环境变量后重新启动");
        }
    }
}
