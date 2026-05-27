package com.launchly.common.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class EditionConfig {
    @Value("${launchly.edition:selfhost}")
    private String edition;

    public String getEdition() {
        return edition;
    }

    public boolean isCloud() {
        return "cloud".equalsIgnoreCase(edition);
    }

    public boolean isSelfHost() {
        return !isCloud();
    }
}
