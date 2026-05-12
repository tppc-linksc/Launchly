package com.launchly.target.dto;

public record VerifyTargetResponse(
        String status,
        String dockerVersion,
        String error
) {
    public static VerifyTargetResponse connected(String dockerVersion) {
        return new VerifyTargetResponse("CONNECTED", dockerVersion, null);
    }

    public static VerifyTargetResponse failed(String error) {
        return new VerifyTargetResponse("FAILED", null, error);
    }
}
